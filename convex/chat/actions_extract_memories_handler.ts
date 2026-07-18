import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { callOpenRouterStreaming } from "../lib/openrouter";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import { MODEL_IDS } from "../lib/model_constants";
import {
  isZdrEnabled,
  selectAncillaryModelForZdr,
  withZdrProvider,
} from "../lib/openrouter_zdr";
import {
  type MemoryRecordLike,
} from "../memory/shared";
import { isMemoryActive } from "./actions_memory_lifecycle";
import {
  detectMemoryExclusionRules,
  isDuplicateMemory,
  memoryLikelyUserFact,
  normalizeMemoryContent,
  parseMemoryExtractionPayload,
  shouldExcludeMemoryContent,
  type ExtractedMemory,
} from "./actions_extract_memories_utils";
import { processExtractedMemoryCandidates } from "./actions_extract_memories_candidates";
import { buildMemoryExtractionMessages } from "./actions_extract_memories_prompt";
import {
  captureBackendAIOperationCompleted,
  captureBackendAIOperationFailed,
  captureBackendAIOperationStarted,
} from "../analytics/backend_events";
import type { OpenRouterUsage } from "../lib/openrouter";
import { resolveTextAncillaryModel } from "../lib/openrouter_modality";

const DEFAULT_MEMORY_MODEL = MODEL_IDS.memoryExtraction;
const MEMORY_FALLBACK_MODEL = MODEL_IDS.memoryExtractionFallback;

export interface ExtractMemoriesArgs extends Record<string, unknown> {
  chatId: Id<"chats">;
  userMessageContent: string;
  userMessageId: Id<"messages">;
  assistantMessageId?: Id<"messages">;
  assistantContent: string;
  userId: string;
  extractionModel?: string;
  isPending?: boolean;
}

export async function extractMemoriesHandler(
  ctx: ActionCtx,
  args: ExtractMemoriesArgs,
): Promise<void> {
  const [existingMemories, prefs] = await Promise.all([
    ctx.runQuery(internal.chat.queries.getUserMemories, {
      userId: args.userId,
    }),
    ctx.runQuery(internal.chat.queries.getUserPreferences, {
      userId: args.userId,
    }),
  ]);

  const existingContext =
    existingMemories.length > 0
      ? "\n\nExisting memories (do NOT duplicate these):\n" +
        existingMemories
          .filter((memory: MemoryRecordLike) => isMemoryActive(memory))
          .slice(0, 60)
          .map((memory: MemoryRecordLike) => `- ${memory.content}`)
          .join("\n")
      : "";

  const exclusionRules = detectMemoryExclusionRules(args.userMessageContent);
  let extracted: ExtractedMemory[] = [];
  let memoryModel = args.extractionModel ?? DEFAULT_MEMORY_MODEL;
  let operationStartedAt: number | undefined;
  let operationUsage: OpenRouterUsage | null = null;
  let operationGenerationId: string | null = null;
  let modelCallSucceeded = false;
  let requireZdr = false;
  try {
    const messages = buildMemoryExtractionMessages(args, existingContext);
    requireZdr = isZdrEnabled(prefs);
    const selectedMemoryModel = selectAncillaryModelForZdr({
      requestedModel: args.extractionModel,
      defaultModel: DEFAULT_MEMORY_MODEL,
      requireZdr,
    });
    memoryModel = await resolveTextAncillaryModel({
      selectedModel: selectedMemoryModel,
      defaultModel: DEFAULT_MEMORY_MODEL,
      feature: "Memory extraction",
      getCapabilities: (modelId) => ctx.runQuery(
        internal.chat.queries.getModelCapabilities,
        { modelId },
      ),
    });
    operationStartedAt = Date.now();
    await captureBackendAIOperationStarted(ctx, {
      userId: args.userId,
      operation: "memory_extraction",
      source: "post_process",
      chatId: String(args.chatId),
      messageId: String(args.assistantMessageId ?? args.userMessageId),
      modelId: memoryModel,
      properties: {
        requested_model_id: args.extractionModel ?? null,
        existing_memory_count: existingMemories.length,
        pending_review: args.isPending === true,
        assistant_message_present: Boolean(args.assistantMessageId),
        zdr_required: requireZdr,
      },
    });
    const apiKey = await getRequiredUserOpenRouterApiKey(ctx, args.userId);
    const result = await callOpenRouterStreaming(
      apiKey,
      memoryModel,
      messages,
      withZdrProvider({ temperature: 0, maxTokens: 500 }, requireZdr),
      {},
      { fallbackModel: MEMORY_FALLBACK_MODEL },
    );
    operationUsage = result.usage;
    operationGenerationId = result.generationId;
    modelCallSucceeded = true;
    extracted = parseMemoryExtractionPayload(result.content);

    // M23: Track memory extraction cost against the assistant message.
    const costMessageId = args.assistantMessageId ?? args.userMessageId;
    if (result.usage) {
      await ctx.scheduler.runAfter(0, internal.chat.mutations.storeAncillaryCost, {
        messageId: costMessageId,
        chatId: args.chatId,
        userId: args.userId,
        modelId: memoryModel,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        cost: result.usage.cost ?? undefined,
        source: "memory_extraction",
        generationId: result.generationId ?? undefined,
      });
    }
  } catch (error) {
    await captureBackendAIOperationFailed(ctx, {
      userId: args.userId,
      operation: "memory_extraction",
      source: "post_process",
      chatId: String(args.chatId),
      messageId: String(args.assistantMessageId ?? args.userMessageId),
      modelId: memoryModel,
      durationMs: operationStartedAt ? Date.now() - operationStartedAt : undefined,
      error,
      properties: {
        requested_model_id: args.extractionModel ?? null,
        existing_memory_count: existingMemories.length,
        pending_review: args.isPending === true,
        stage: "model_call",
        zdr_required: requireZdr,
      },
    });
    console.error("Memory extraction model call failed", error);
  }

  try {
    const counts = await processExtractedMemoryCandidates(
      ctx,
      args,
      extracted,
      existingMemories,
      exclusionRules,
    );

    if (modelCallSucceeded) {
      await captureBackendAIOperationCompleted(ctx, {
        userId: args.userId,
        operation: "memory_extraction",
        source: "post_process",
        chatId: String(args.chatId),
        messageId: String(args.assistantMessageId ?? args.userMessageId),
        modelId: memoryModel,
        usage: operationUsage,
        durationMs: operationStartedAt ? Date.now() - operationStartedAt : undefined,
        openrouterGenerationId: operationGenerationId,
        properties: {
          requested_model_id: args.extractionModel ?? null,
          raw_candidate_count: extracted.length,
          processed_candidate_count: Math.min(extracted.length, 4),
          created_memory_count: counts.createdCount,
          reinforced_memory_count: counts.reinforcedCount,
          superseded_memory_count: counts.supersededCount,
          skipped_candidate_count: counts.skippedCount,
          embedding_scheduled_count: counts.embeddingScheduledCount,
          existing_memory_count: existingMemories.length,
          pending_review: args.isPending === true,
        },
      });
    }
  } catch {
    if (modelCallSucceeded) {
      await captureBackendAIOperationFailed(ctx, {
        userId: args.userId,
        operation: "memory_extraction",
        source: "post_process",
        chatId: String(args.chatId),
        messageId: String(args.assistantMessageId ?? args.userMessageId),
        modelId: memoryModel,
        durationMs: operationStartedAt ? Date.now() - operationStartedAt : undefined,
        error: new Error("Memory extraction persistence failed."),
        properties: {
          requested_model_id: args.extractionModel ?? null,
          raw_candidate_count: extracted.length,
          stage: "persistence",
        },
      });
    }
    // Memory extraction is best-effort and should not fail the overall chat flow.
    console.error("Memory extraction failed");
  }
}

export {
  detectMemoryExclusionRules,
  isDuplicateMemory,
  memoryLikelyUserFact,
  normalizeMemoryContent,
  parseMemoryExtractionPayload,
  shouldExcludeMemoryContent,
};
