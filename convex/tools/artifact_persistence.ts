import { type Infer, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { assertCurrentFence } from "../execution/control_plane";
import { isUserDataWritable } from "../lib/write_fence";
import {
  storeAncillaryCostHandler,
  type StoreAncillaryCostArgs,
} from "../chat/mutations_internal_handlers";
import { extractToolMemoryDrafts, type PersistedArtifactRef } from "./tool_memory_extractor";

export const artifactInput = v.object({
  userId: v.string(), chatId: v.id("chats"), messageId: v.id("messages"),
  jobId: v.id("generationJobs"), branchRootMessageId: v.optional(v.id("messages")),
  sourceUserMessageId: v.optional(v.id("messages")), multiModelGroupId: v.optional(v.string()),
  runtimeKind: v.optional(v.union(v.literal("chat_generation"), v.literal("autonomous_discussion"),
    v.literal("subagent_child"), v.literal("subagent_parent_resume"), v.literal("scheduled_job"))),
  subagentBatchId: v.optional(v.id("subagentBatches")), subagentRunId: v.optional(v.id("subagentRuns")),
  parentMessageId: v.optional(v.id("messages")), parentJobId: v.optional(v.id("generationJobs")),
  parentToolCallId: v.optional(v.string()),
  promotionDecision: v.optional(v.union(v.literal("child_private"), v.literal("parent_resume"),
    v.literal("parent_visible"), v.literal("audit_only"))),
  visibilityScope: v.union(v.literal("participant"), v.literal("shared_participants"),
    v.literal("branch"), v.literal("conversation"), v.literal("audit_only")),
  ownerParticipantId: v.optional(v.string()), ownerModelRunId: v.optional(v.string()),
  sharedWithParticipants: v.optional(v.array(v.string())),
  runtimeIsolationPolicy: v.union(v.literal("isolated"), v.literal("shared_readonly"),
    v.literal("shared_mutable"), v.literal("audit_only")),
  toolCallId: v.string(), toolName: v.string(), round: v.number(),
  argumentsRaw: v.optional(v.string()), argumentsHash: v.string(), argumentsBytes: v.number(),
  resultRaw: v.optional(v.string()), resultHash: v.optional(v.string()), resultBytes: v.optional(v.number()),
  argumentsStorageId: v.optional(v.id("_storage")), resultStorageId: v.optional(v.id("_storage")),
  status: v.union(v.literal("pending"), v.literal("completed"), v.literal("failed"),
    v.literal("deferred"), v.literal("cancelled")),
  isError: v.optional(v.boolean()), errorCode: v.optional(v.string()), errorMessage: v.optional(v.string()),
  deferredKind: v.optional(v.union(v.literal("spawn_subagents"), v.literal("drive_picker"),
    v.literal("presentation_workflow"), v.literal("analytics_workflow"))),
  provider: v.optional(v.string()), runtime: v.optional(v.string()), integrationId: v.optional(v.string()),
  skillIds: v.optional(v.array(v.id("skills"))), activeProfiles: v.optional(v.array(v.string())),
  privacyClassification: v.union(v.literal("normal"), v.literal("oauth_data"), v.literal("google_data"),
    v.literal("document_data"), v.literal("runtime_file_data"), v.literal("secret_adjacent")),
  contextClass: v.union(v.literal("operational"), v.literal("provenance"),
    v.literal("recovery"), v.literal("policy")),
});

export type ArtifactInput = Infer<typeof artifactInput>;
export type CaptureFence = {
  executionAttemptId?: Id<"executionAttempts">;
  executionFence?: number;
};

export type ArtifactUsageInput = StoreAncillaryCostArgs & { idempotencyKey: string };

async function captureWritable(
  ctx: MutationCtx,
  args: CaptureFence & { userId: string; chatId: Id<"chats">; jobId: Id<"generationJobs"> },
): Promise<boolean> {
  if ((args.executionAttemptId === undefined) !== (args.executionFence === undefined)) return false;
  if (!await isUserDataWritable(ctx, args.userId, args.chatId)) return false;
  const job = await ctx.db.get(args.jobId);
  if (!job || job.userId !== args.userId || job.chatId !== args.chatId) return false;
  if (["completed", "failed", "cancelled", "timedOut"].includes(job.status)) return false;
  if (args.executionAttemptId && args.executionFence !== undefined) {
    try {
      await assertCurrentFence(ctx, args.executionAttemptId, args.executionFence);
    } catch {
      return false;
    }
  }
  return true;
}

export async function prepareArtifactCapture(
  ctx: MutationCtx,
  args: CaptureFence & {
    captureKey: string; jobId: Id<"generationJobs">; userId: string; chatId: Id<"chats">;
  },
): Promise<{ decision: "execute" | "replay" | "stale"; artifactIds: Id<"toolExecutionArtifacts">[] }> {
  if (!await captureWritable(ctx, args)) return { decision: "stale", artifactIds: [] };
  const existing = await ctx.db.query("toolExecutionArtifacts")
    .withIndex("by_job_capture", (q) => q.eq("jobId", args.jobId).eq("captureKey", args.captureKey))
    .collect();
  if (existing.length > 0) return { decision: "replay", artifactIds: existing.map((row) => row._id) };
  return { decision: "execute", artifactIds: [] };
}

export async function persistArtifactCapture(
  ctx: MutationCtx,
  args: CaptureFence & {
    captureKey: string; artifacts: ArtifactInput[]; usages?: ArtifactUsageInput[];
    extractMemories?: boolean; legacyUnfenced?: boolean;
  },
): Promise<{ inserted: boolean; stale: boolean; artifactIds: Id<"toolExecutionArtifacts">[] }> {
  const first = args.artifacts[0];
  if (!first) return { inserted: false, stale: false, artifactIds: [] };
  if (!args.legacyUnfenced) {
    if (!await captureWritable(ctx, { ...args, ...first })) {
      return { inserted: false, stale: true, artifactIds: [] };
    }
    const existing = await ctx.db.query("toolExecutionArtifacts")
      .withIndex("by_job_capture", (q) => q.eq("jobId", first.jobId).eq("captureKey", args.captureKey))
      .collect();
    if (existing.length > 0) {
      return { inserted: false, stale: false, artifactIds: existing.map((row) => row._id) };
    }
  }
  const now = Date.now();
  const inserted = [];
  for (const artifact of args.artifacts) {
    const id = await ctx.db.insert("toolExecutionArtifacts", {
      ...artifact,
      captureKey: args.captureKey,
      executionAttemptId: args.executionAttemptId,
      executionFence: args.executionFence,
      createdAt: now,
      updatedAt: now,
    });
    inserted.push({ _id: id, ...artifact });
  }
  if (args.extractMemories !== false) await persistMemories(ctx, inserted, now);
  for (const usage of args.usages ?? []) {
    await storeAncillaryCostHandler(ctx, usage);
  }
  return { inserted: true, stale: false, artifactIds: inserted.map((row) => row._id) };
}

async function persistMemories(
  ctx: MutationCtx,
  inserted: Array<ArtifactInput & { _id: Id<"toolExecutionArtifacts"> }>,
  now: number,
): Promise<void> {
  const refs: PersistedArtifactRef[] = inserted.map((artifact) => ({
    _id: artifact._id, toolName: artifact.toolName, status: artifact.status,
    resultRaw: artifact.resultRaw, resultBytes: artifact.resultBytes,
    storageId: artifact.resultStorageId, isError: artifact.isError,
    privacyClassification: artifact.privacyClassification, contextClass: artifact.contextClass,
  }));
  for (const draft of extractToolMemoryDrafts({ artifacts: refs })) {
    const sourceIds = draft.sourceArtifactIds?.length ? draft.sourceArtifactIds : inserted.map((row) => row._id);
    const sourceSet = new Set(sourceIds.map(String));
    const first = inserted.find((row) => sourceSet.has(String(row._id))) ?? inserted[0];
    if (!first) continue;
    await ctx.db.insert("toolMemories", {
      userId: first.userId, chatId: first.chatId, messageId: first.messageId, branchScope: "message",
      runtimeKind: first.runtimeKind, subagentBatchId: first.subagentBatchId, subagentRunId: first.subagentRunId,
      parentMessageId: first.parentMessageId, parentJobId: first.parentJobId, parentToolCallId: first.parentToolCallId,
      promotionDecision: first.promotionDecision, visibilityScope: first.visibilityScope,
      ownerParticipantId: first.ownerParticipantId, ownerModelRunId: first.ownerModelRunId,
      sharedWithParticipants: first.sharedWithParticipants, runtimeIsolationPolicy: first.runtimeIsolationPolicy,
      kind: draft.kind, contextClass: draft.contextClass, promotionPolicy: draft.promotionPolicy,
      summary: draft.summary, structuredPayload: draft.structuredPayload, artifactIds: sourceIds,
      sourceArtifactIds: sourceIds, sourceToolNames: draft.sourceToolNames, confidence: draft.confidence,
      confidenceSource: draft.confidenceSource, confidenceRationale: draft.confidenceRationale,
      ambiguities: draft.ambiguities, limitations: draft.limitations,
      privacyClassification: draft.privacyClassification, freshnessClass: draft.freshnessClass,
      observedAt: now, staleAfter: draft.staleAfter, confidenceDecayCurve: "none",
      requiresRevalidation: draft.requiresRevalidation, provenanceLocators: draft.provenanceLocators,
      revalidationToolNames: draft.revalidationToolNames, expiresAt: draft.expiresAt,
      createdAt: now, updatedAt: now,
    });
  }
}
