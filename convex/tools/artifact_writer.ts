import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { ToolCall } from "../lib/openrouter";
import type { OpenRouterUsage } from "../lib/openrouter";
import type { ToolResult } from "./registry";
import { deleteStoredPayloads, toolRoundCaptureKey } from "./artifact_capture_client";
import type { ArtifactUsageInput } from "./artifact_persistence";

const INLINE_RAW_BYTE_LIMIT = 96_000;

export interface ToolArtifactRunMetadata {
  userId: string;
  chatId: Id<"chats">;
  messageId: Id<"messages">;
  jobId: Id<"generationJobs">;
  branchRootMessageId?: Id<"messages">;
  sourceUserMessageId?: Id<"messages">;
  multiModelGroupId?: string;
  runtimeKind?: "chat_generation" | "autonomous_discussion" | "subagent_child" | "subagent_parent_resume" | "scheduled_job";
  subagentBatchId?: Id<"subagentBatches">;
  subagentRunId?: Id<"subagentRuns">;
  parentMessageId?: Id<"messages">;
  parentJobId?: Id<"generationJobs">;
  parentToolCallId?: string;
  promotionDecision?: "child_private" | "parent_resume" | "parent_visible" | "audit_only";
  visibilityScope?: "participant" | "shared_participants" | "branch" | "conversation" | "audit_only";
  runtimeIsolationPolicy?: "isolated" | "shared_readonly" | "shared_mutable" | "audit_only";
  ownerParticipantId?: string;
  ownerModelRunId?: string;
  sharedWithParticipants?: string[];
  provider?: string;
  runtime?: string;
  activeProfiles?: string[];
  executionAttemptId?: Id<"executionAttempts">;
  executionFence?: number;
}

export interface ToolRoundArtifactInput {
  ctx: ActionCtx;
  metadata: ToolArtifactRunMetadata;
  round: number;
  toolCalls: ToolCall[];
  results: Array<{ toolCallId: string; result: ToolResult }>;
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function resultPayload(result: ToolResult): unknown {
  if (result.artifactData !== undefined) return result.artifactData;
  if (result.success) return result.data;
  if (result.data && typeof result.data === "object") {
    return { error: result.error, ...(result.data as Record<string, unknown>) };
  }
  if (result.data != null) return { error: result.error, data: result.data };
  return { error: result.error };
}

type PrivacyClassification =
  | "normal"
  | "oauth_data"
  | "google_data"
  | "document_data"
  | "runtime_file_data"
  | "secret_adjacent";

function privacyForTool(toolName: string): PrivacyClassification {
  if (toolName.includes("google") || toolName.includes("gmail") || toolName.includes("drive")) {
    return "google_data";
  }
  if (toolName.includes("oauth") || toolName.includes("token")) return "oauth_data";
  if (toolName.includes("document") || toolName.includes("docx")) return "document_data";
  if (toolName.includes("bash") || toolName.includes("python") || toolName.includes("workspace")) {
    return "runtime_file_data";
  }
  return "normal";
}

function contextClassForResult(result: ToolResult): "operational" | "provenance" | "recovery" | "policy" {
  if (!result.success || result.deferred) return "recovery";
  return "operational";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOpenRouterUsage(value: unknown): value is OpenRouterUsage {
  return isRecord(value)
    && typeof value.promptTokens === "number"
    && typeof value.completionTokens === "number"
    && typeof value.totalTokens === "number";
}

function optionalNumber(value: number | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function extractWebSearchUsage(
  toolName: string,
  result: ToolResult,
): { usage: OpenRouterUsage; modelId: string; generationId?: string } | null {
  if (toolName !== "web_search" || !result.success || !isRecord(result.artifactData)) {
    return null;
  }
  const usage = result.artifactData.usage;
  const modelId = result.artifactData.modelId;
  if (!isOpenRouterUsage(usage) || typeof modelId !== "string" || modelId.trim().length === 0) {
    return null;
  }
  const generationId = result.artifactData.generationId;
  return {
    usage,
    modelId,
    generationId: typeof generationId === "string" && generationId.trim().length > 0
      ? generationId
      : undefined,
  };
}

function webSearchUsageInput(
  metadata: ToolArtifactRunMetadata,
  payload: { usage: OpenRouterUsage; modelId: string; generationId?: string },
  idempotencyKey: string,
): ArtifactUsageInput {
  return {
    messageId: metadata.messageId,
    chatId: metadata.chatId,
    userId: metadata.userId,
    modelId: payload.modelId,
    promptTokens: payload.usage.promptTokens,
    completionTokens: payload.usage.completionTokens,
    totalTokens: payload.usage.totalTokens,
    cost: payload.usage.cost ?? undefined,
    isByok: payload.usage.isByok,
    cachedTokens: optionalNumber(payload.usage.cachedTokens),
    cacheWriteTokens: optionalNumber(payload.usage.cacheWriteTokens),
    audioPromptTokens: optionalNumber(payload.usage.audioPromptTokens),
    videoTokens: optionalNumber(payload.usage.videoTokens),
    reasoningTokens: optionalNumber(payload.usage.reasoningTokens),
    imageCompletionTokens: optionalNumber(payload.usage.imageCompletionTokens),
    audioCompletionTokens: optionalNumber(payload.usage.audioCompletionTokens),
    upstreamInferenceCost: optionalNumber(payload.usage.upstreamInferenceCost),
    upstreamInferencePromptCost: optionalNumber(payload.usage.upstreamInferencePromptCost),
    upstreamInferenceCompletionsCost: optionalNumber(payload.usage.upstreamInferenceCompletionsCost),
    cacheDiscount: optionalNumber(payload.usage.cacheDiscount),
    webSearchRequests: optionalNumber(payload.usage.webSearchRequests),
    source: "tool_web_search",
    generationId: payload.generationId,
    idempotencyKey,
  };
}

async function maybeStoreRaw(
  ctx: ActionCtx,
  raw: string,
): Promise<{ raw?: string; storageId?: Id<"_storage"> }> {
  if (byteLength(raw) <= INLINE_RAW_BYTE_LIMIT) {
    return { raw };
  }
  const storageId = await ctx.storage.store(new Blob([raw], { type: "application/json" }));
  return { storageId };
}

export async function captureToolRoundArtifacts(
  input: ToolRoundArtifactInput,
): Promise<Array<Id<"toolExecutionArtifacts">>> {
  if (input.toolCalls.length === 0) return [];
  const captureKey = await toolRoundCaptureKey(input);
  const prepared = await input.ctx.runMutation(
    internal.tools.artifacts.prepareToolArtifactCapture,
    {
      captureKey,
      jobId: input.metadata.jobId,
      userId: input.metadata.userId,
      chatId: input.metadata.chatId,
      executionAttemptId: input.metadata.executionAttemptId,
      executionFence: input.metadata.executionFence,
    },
  ) as {
    decision: "execute" | "replay" | "stale";
    artifactIds: Array<Id<"toolExecutionArtifacts">>;
  };
  if (prepared.decision === "stale") return [];

  const webSearchUsages = input.toolCalls.flatMap((call, index) => {
    const matching = input.results.find((entry) => entry.toolCallId === call.id);
    if (!matching) return [];
    const usage = extractWebSearchUsage(call.function.name, matching.result);
    return usage ? [webSearchUsageInput(
      input.metadata,
      usage,
      `${captureKey}:tool:${index}:${call.function.name}`,
    )] : [];
  });
  if (prepared.decision === "replay") {
    return prepared.artifactIds;
  }

  const artifacts = [];
  const storedPayloadIds: Array<Id<"_storage">> = [];
  for (const call of input.toolCalls) {
    const matching = input.results.find((entry) => entry.toolCallId === call.id);
    if (!matching) continue;
    const argsRaw = call.function.arguments || "{}";
    const payload = resultPayload(matching.result);
    const resultRaw = JSON.stringify(payload);
    const argsStorage = await maybeStoreRaw(input.ctx, argsRaw);
    const resultStorage = await maybeStoreRaw(input.ctx, resultRaw);
    if (argsStorage.storageId) storedPayloadIds.push(argsStorage.storageId);
    if (resultStorage.storageId) storedPayloadIds.push(resultStorage.storageId);
    artifacts.push({
      userId: input.metadata.userId,
      chatId: input.metadata.chatId,
      messageId: input.metadata.messageId,
      jobId: input.metadata.jobId,
      branchRootMessageId: input.metadata.branchRootMessageId,
      sourceUserMessageId: input.metadata.sourceUserMessageId,
      multiModelGroupId: input.metadata.multiModelGroupId,
      runtimeKind: input.metadata.runtimeKind ?? "chat_generation",
      subagentBatchId: input.metadata.subagentBatchId,
      subagentRunId: input.metadata.subagentRunId,
      parentMessageId: input.metadata.parentMessageId,
      parentJobId: input.metadata.parentJobId,
      parentToolCallId: input.metadata.parentToolCallId,
      promotionDecision: input.metadata.promotionDecision,
      visibilityScope: input.metadata.visibilityScope ?? "participant" as const,
      ownerParticipantId: input.metadata.ownerParticipantId,
      ownerModelRunId: input.metadata.ownerModelRunId,
      sharedWithParticipants: input.metadata.sharedWithParticipants,
      runtimeIsolationPolicy: input.metadata.runtimeIsolationPolicy ?? "isolated" as const,
      toolCallId: call.id,
      toolName: call.function.name,
      round: input.round,
      argumentsRaw: argsStorage.raw,
      argumentsHash: await sha256Hex(argsRaw),
      argumentsBytes: byteLength(argsRaw),
      resultRaw: resultStorage.raw,
      resultHash: await sha256Hex(resultRaw),
      resultBytes: byteLength(resultRaw),
      argumentsStorageId: argsStorage.storageId,
      resultStorageId: resultStorage.storageId,
      status: matching.result.deferred
        ? "deferred" as const
        : matching.result.success
          ? "completed" as const
          : "failed" as const,
      isError: matching.result.success ? undefined : true,
      errorMessage: matching.result.success ? undefined : matching.result.error,
      deferredKind: matching.result.deferred?.kind,
      provider: input.metadata.provider,
      runtime: input.metadata.runtime,
      activeProfiles: input.metadata.activeProfiles,
      privacyClassification: privacyForTool(call.function.name),
      contextClass: contextClassForResult(matching.result),
    });
  }
  if (artifacts.length === 0) return [];
  try {
    const committed = await input.ctx.runMutation(
      internal.tools.artifacts.commitToolArtifactCapture,
      {
        captureKey,
        artifacts,
        usages: webSearchUsages,
        extractMemories: true,
        executionAttemptId: input.metadata.executionAttemptId,
        executionFence: input.metadata.executionFence,
      },
    ) as {
      inserted: boolean;
      stale: boolean;
      artifactIds: Array<Id<"toolExecutionArtifacts">>;
    };
    if (!committed.inserted) await deleteStoredPayloads(input.ctx, storedPayloadIds);
    if (committed.stale) return [];
    return committed.artifactIds;
  } catch (error) {
    await deleteStoredPayloads(input.ctx, storedPayloadIds);
    throw error;
  }
}
