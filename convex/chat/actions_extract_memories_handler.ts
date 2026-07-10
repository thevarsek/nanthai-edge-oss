import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { callOpenRouterStreaming, OpenRouterMessage } from "../lib/openrouter";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import { MODEL_IDS } from "../lib/model_constants";
import {
  isZdrEnabled,
  selectAncillaryModelForZdr,
  withZdrProvider,
} from "../lib/openrouter_zdr";
import {
  normalizeMemoryCategory,
  normalizeMemoryRecord,
  normalizeMemoryRetrievalMode,
  type MemoryRecordLike,
} from "../memory/shared";
import {
  classifyMemoryType,
  computeLifecycleScores,
  findConflictingMemory,
  isMemoryActive,
} from "./actions_memory_lifecycle";
import {
  detectMemoryExclusionRules,
  findDuplicateMemory,
  isDuplicateMemory,
  memoryLikelyUserFact,
  normalizeMemoryContent,
  parseMemoryExtractionPayload,
  shouldExcludeMemoryContent,
  type ExtractedMemory,
} from "./actions_extract_memories_utils";
import {
  captureBackendAIOperationCompleted,
  captureBackendAIOperationFailed,
  captureBackendAIOperationStarted,
} from "../analytics/backend_events";
import type { OpenRouterUsage } from "../lib/openrouter";
import { resolveTextAncillaryModel } from "../lib/openrouter_modality";

const DEFAULT_MEMORY_MODEL = MODEL_IDS.memoryExtraction;
const MEMORY_FALLBACK_MODEL = MODEL_IDS.memoryExtractionFallback;
const MIN_IMPORTANCE_SCORE = 0.5;
const MIN_CONFIDENCE_SCORE = 0.45;

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

function buildMemoryExtractionMessages(
  args: ExtractMemoriesArgs,
  existingContext: string,
): OpenRouterMessage[] {
  const systemPrompt = `You are a selective long-term memory curator.
The conversation may be in any language.
Keep NEW, user-centric facts that make future replies feel personal and helpful.
If uncertain, return [].

Rules:
- Extract at most 4 atomic facts per exchange
- Each fact must be about the USER (identity, relationships/loved ones, stable preferences/hobbies, ongoing life/work context, long-term goals, persistent constraints)
- Prefer first-person claims from the user over assistant summaries
- Behavioral summaries are allowed only when phrased as recurring patterns (e.g. "User frequently asks about...")
- Facts must be specific and actionable, not generic observations
- Keep each fact in the user's language when possible
- Exclude transient incidents, one-off debugging context, and conversation metadata
- Temporary interests are allowed only if framed as enduring preference or repeated intent
- Contact details (phone, email, exact address) should be excluded unless the user explicitly asked to remember them
- Do NOT extract facts about the assistant or the conversation itself
- Do NOT duplicate existing memories
- For each fact, provide:
  - "content": string
  - "category": one of "identity" | "writingStyle" | "work" | "goals" | "background" | "relationships" | "preferences" | "tools" | "skills" | "logistics"
  - "memoryType": one of "profile" | "responsePreference" | "workContext" | "transient"
  - "retrievalMode": one of "alwaysOn" | "contextual" | "disabled"
  - "importanceScore": number between 0 and 1
  - "confidenceScore": number between 0 and 1
  - "tags": optional string array
  - "expiresInDays": optional integer (only for short-lived context)
- Respond with a JSON array of objects only.
- If no memories should be extracted, respond with an empty array: []
${existingContext}`;

  return [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `User said: ${args.userMessageContent}\n\nAssistant responded: ${args.assistantContent}`,
    },
  ];
}

function logMemorySkip(reason: string, content: string) {
  console.log(`[memory] skipped ${reason}: ${content.slice(0, 120)}`);
}

function clampScore(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function resolveMemoryType(item: ExtractedMemory, content: string) {
  const raw = item.memoryType?.trim().toLowerCase();
  if (raw === "profile") return "profile" as const;
  if (raw === "responsepreference" || raw === "response_preference" || raw === "preference") {
    return "responsePreference" as const;
  }
  if (raw === "workcontext" || raw === "work_context" || raw === "work") {
    return "workContext" as const;
  }
  if (raw === "transient") return "transient" as const;
  return classifyMemoryType(content);
}

function resolveExpiresAt(
  item: ExtractedMemory,
  fallbackExpiresAt: number | undefined,
  now: number,
): number | undefined {
  const expiresInDays = item.expiresInDays;
  if (typeof expiresInDays === "number" && Number.isFinite(expiresInDays)) {
    const boundedDays = Math.max(1, Math.min(365, Math.round(expiresInDays)));
    return now + boundedDays * 24 * 60 * 60 * 1000;
  }
  return fallbackExpiresAt;
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
    let skippedCount = 0;
    let reinforcedCount = 0;
    let supersededCount = 0;
    let createdCount = 0;
    let embeddingScheduledCount = 0;

    if (extracted.length === 0) {
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
            raw_candidate_count: 0,
            created_memory_count: 0,
            reinforced_memory_count: 0,
            superseded_memory_count: 0,
            skipped_candidate_count: 0,
            embedding_scheduled_count: 0,
            existing_memory_count: existingMemories.length,
            pending_review: args.isPending === true,
          },
        });
      }
      return;
    }

    for (const item of extracted.slice(0, 4)) {
      const normalizedContent = normalizeMemoryContent(item.content ?? "");
      if (!normalizedContent) {
        skippedCount += 1;
        logMemorySkip("invalid_empty", item.content ?? "");
        continue;
      }
      if (normalizedContent.length > 280) {
        skippedCount += 1;
        logMemorySkip("too_long", normalizedContent);
        continue;
      }
      if (shouldExcludeMemoryContent(normalizedContent, exclusionRules)) {
        skippedCount += 1;
        logMemorySkip("privacy", normalizedContent);
        continue;
      }
      if (!memoryLikelyUserFact(normalizedContent)) {
        skippedCount += 1;
        logMemorySkip("meta_or_low_quality", normalizedContent);
        continue;
      }

      const memoryType = resolveMemoryType(item, normalizedContent);
      const lifecycle = computeLifecycleScores(normalizedContent, memoryType);
      const category = normalizeMemoryCategory(item.category, normalizedContent, memoryType);
      const retrievalMode = normalizeMemoryRetrievalMode(
        item.retrievalMode,
        category,
        memoryType,
      );
      const importanceScore = clampScore(item.importanceScore, lifecycle.importanceScore);
      const confidenceScore = clampScore(item.confidenceScore, lifecycle.confidenceScore);
      if (importanceScore < MIN_IMPORTANCE_SCORE) {
        skippedCount += 1;
        logMemorySkip("low_importance", normalizedContent);
        continue;
      }
      if (confidenceScore < MIN_CONFIDENCE_SCORE) {
        skippedCount += 1;
        logMemorySkip("low_confidence", normalizedContent);
        continue;
      }

      const now = Date.now();
      const expiresAt = resolveExpiresAt(item, lifecycle.expiresAt, now);
      const duplicate = findDuplicateMemory(normalizedContent, existingMemories) as { _id?: Id<"memories"> } | null;
      if (duplicate && duplicate._id) {
        await ctx.runMutation(internal.chat.mutations.reinforceMemory, {
          memoryId: duplicate._id,
          reinforcedAt: now,
          candidateMemoryType: memoryType,
          candidateImportanceScore: importanceScore,
          candidateConfidenceScore: confidenceScore,
          candidateExpiresAt: expiresAt,
        });
        reinforcedCount += 1;
        logMemorySkip("duplicate_reinforced", normalizedContent);
        continue;
      }
      if (isDuplicateMemory(normalizedContent, existingMemories)) {
        skippedCount += 1;
        logMemorySkip("duplicate", normalizedContent);
        continue;
      }

      const conflicting = findConflictingMemory(
        normalizedContent,
        lifecycle.memoryType,
        existingMemories.filter((memory: MemoryRecordLike) => isMemoryActive(memory)),
      );
      if (conflicting?._id) {
        await ctx.runMutation(internal.chat.mutations.supersedeMemory, {
          memoryId: conflicting._id,
          supersededAt: now,
        });
        supersededCount += 1;
      }

      const memoryId = await ctx.runMutation(internal.chat.mutations.createMemory, {
        userId: args.userId,
        content: normalizedContent,
        category: category,
        memoryType,
        retrievalMode,
        importanceScore,
        confidenceScore,
        reinforcementCount: 1,
        lastReinforcedAt: now,
        expiresAt,
        supersedesMemoryId: conflicting?._id,
        sourceMessageId: args.userMessageId,
        sourceChatId: args.chatId,
        sourceType: "chat",
        tags: item.tags,
        isPending: args.isPending ?? false,
        createdAt: now,
      });

      existingMemories.unshift(normalizeMemoryRecord({
        _id: memoryId,
        content: normalizedContent,
        category,
        memoryType,
        retrievalMode,
        importanceScore,
        confidenceScore,
        isPending: args.isPending ?? false,
        isSuperseded: false,
        createdAt: now,
        updatedAt: now,
        isPinned: false,
        accessCount: 0,
        sourceType: "chat",
        tags: item.tags,
      }));
      createdCount += 1;

      await ctx.scheduler.runAfter(0, internal.memory.operations.computeAndStoreEmbedding, {
        memoryId,
        content: normalizedContent,
      });
      embeddingScheduledCount += 1;
    }

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
          created_memory_count: createdCount,
          reinforced_memory_count: reinforcedCount,
          superseded_memory_count: supersededCount,
          skipped_candidate_count: skippedCount,
          embedding_scheduled_count: embeddingScheduledCount,
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
