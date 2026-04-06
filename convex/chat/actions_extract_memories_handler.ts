import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { callOpenRouterStreaming, OpenRouterMessage } from "../lib/openrouter";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import { MODEL_IDS } from "../lib/model_constants";
import {
  normalizeMemoryCategory,
  normalizeMemoryRecord,
  normalizeMemoryRetrievalMode,
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
  const existingMemories = await ctx.runQuery(internal.chat.queries.getUserMemories, {
    userId: args.userId,
  });

  const existingContext =
    existingMemories.length > 0
      ? "\n\nExisting memories (do NOT duplicate these):\n" +
        existingMemories
          .filter((memory) => isMemoryActive(memory))
          .slice(0, 60)
          .map((memory) => `- ${memory.content}`)
          .join("\n")
      : "";

  const exclusionRules = detectMemoryExclusionRules(args.userMessageContent);
  let extracted: ExtractedMemory[] = [];
  try {
    const apiKey = await getRequiredUserOpenRouterApiKey(ctx, args.userId);
    const messages = buildMemoryExtractionMessages(args, existingContext);
    const memoryModel = args.extractionModel || DEFAULT_MEMORY_MODEL;
    const result = await callOpenRouterStreaming(
      apiKey,
      memoryModel,
      messages,
      { temperature: 0, maxTokens: 500 },
      {},
      { fallbackModel: MEMORY_FALLBACK_MODEL },
    );
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
    console.error("Memory extraction model call failed", error);
  }

  try {
    if (extracted.length === 0) return;

    for (const item of extracted.slice(0, 4)) {
      const normalizedContent = normalizeMemoryContent(item.content ?? "");
      if (!normalizedContent) {
        logMemorySkip("invalid_empty", item.content ?? "");
        continue;
      }
      if (normalizedContent.length > 280) {
        logMemorySkip("too_long", normalizedContent);
        continue;
      }
      if (shouldExcludeMemoryContent(normalizedContent, exclusionRules)) {
        logMemorySkip("privacy", normalizedContent);
        continue;
      }
      if (!memoryLikelyUserFact(normalizedContent)) {
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
        logMemorySkip("low_importance", normalizedContent);
        continue;
      }
      if (confidenceScore < MIN_CONFIDENCE_SCORE) {
        logMemorySkip("low_confidence", normalizedContent);
        continue;
      }

      const now = Date.now();
      const expiresAt = resolveExpiresAt(item, lifecycle.expiresAt, now);
      const duplicate = findDuplicateMemory(normalizedContent, existingMemories);
      if (duplicate && duplicate._id) {
        await ctx.runMutation(internal.chat.mutations.reinforceMemory, {
          memoryId: duplicate._id,
          reinforcedAt: now,
          candidateMemoryType: memoryType,
          candidateImportanceScore: importanceScore,
          candidateConfidenceScore: confidenceScore,
          candidateExpiresAt: expiresAt,
        });
        logMemorySkip("duplicate_reinforced", normalizedContent);
        continue;
      }
      if (isDuplicateMemory(normalizedContent, existingMemories)) {
        logMemorySkip("duplicate", normalizedContent);
        continue;
      }

      const conflicting = findConflictingMemory(
        normalizedContent,
        lifecycle.memoryType,
        existingMemories.filter((memory) => isMemoryActive(memory)),
      );
      if (conflicting?._id) {
        await ctx.runMutation(internal.chat.mutations.supersedeMemory, {
          memoryId: conflicting._id,
          supersededAt: now,
        });
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

      await ctx.scheduler.runAfter(0, internal.memory.operations.computeAndStoreEmbedding, {
        memoryId,
        content: normalizedContent,
      });
    }
  } catch {
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
