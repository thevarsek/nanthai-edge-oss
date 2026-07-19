import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  expiryForDurability,
  isExplicitMemoryInstruction,
  isOneOffTaskContent,
  normalizeMemoryScore,
  resolveAutomaticRetrievalMode,
  shouldAdmitChatCandidate,
  type EvidenceSpan,
  type MemoryDurability,
} from "../memory/quality_policy";
import {
  normalizeMemoryCategory,
  normalizeMemoryRecord,
  type MemoryRecordLike,
} from "../memory/shared";
import {
  classifyMemoryType,
  computeLifecycleScores,
  findConflictingMemory,
  isMemoryActive,
} from "./actions_memory_lifecycle";
import {
  findDuplicateMemory,
  isDuplicateMemory,
  memoryLikelyUserFact,
  normalizeMemoryContent,
  shouldExcludeMemoryContent,
  type ExtractedMemory,
  type MemoryExclusionRules,
} from "./actions_extract_memories_utils";

const MIN_IMPORTANCE_SCORE = 0.65;
const MIN_CONFIDENCE_SCORE = 0.7;

export interface MemoryCandidateCounts {
  skippedCount: number;
  reinforcedCount: number;
  supersededCount: number;
  createdCount: number;
  embeddingScheduledCount: number;
}

function logMemorySkip(reason: string, content: string) {
  console.log(`[memory] skipped ${reason}: ${content.slice(0, 120)}`);
}

function resolveMemoryType(item: ExtractedMemory, content: string) {
  const category = item.category?.trim().toLowerCase();
  if (
    item.evidenceKind === "explicitPreference" ||
    category === "writingstyle" ||
    category === "writing_style" ||
    category === "preferences"
  ) {
    return "responsePreference" as const;
  }
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

export async function processExtractedMemoryCandidates(
  ctx: ActionCtx,
  args: {
    chatId: Id<"chats">;
    userMessageContent: string;
    userMessageId: Id<"messages">;
    userId: string;
    isPending?: boolean;
  },
  extracted: ExtractedMemory[],
  existingMemories: MemoryRecordLike[],
  exclusionRules: MemoryExclusionRules,
): Promise<MemoryCandidateCounts> {
  const counts: MemoryCandidateCounts = {
    skippedCount: 0,
    reinforcedCount: 0,
    supersededCount: 0,
    createdCount: 0,
    embeddingScheduledCount: 0,
  };
  const acceptedEvidence: EvidenceSpan[] = [];

  for (const item of extracted.slice(0, 4)) {
    const content = normalizeMemoryContent(item.content ?? "");
    if (!content || content.length > 280) {
      counts.skippedCount += 1;
      logMemorySkip(content ? "too_long" : "invalid_empty", content ?? item.content ?? "");
      continue;
    }
    if (shouldExcludeMemoryContent(content, exclusionRules)) {
      counts.skippedCount += 1;
      logMemorySkip("privacy", content);
      continue;
    }
    if (!memoryLikelyUserFact(content)) {
      counts.skippedCount += 1;
      logMemorySkip("meta_or_low_quality", content);
      continue;
    }

    const memoryType = resolveMemoryType(item, content);
    const lifecycle = computeLifecycleScores(content, memoryType);
    const category = normalizeMemoryCategory(item.category, content, memoryType);
    const admission = shouldAdmitChatCandidate({
      userMessage: args.userMessageContent,
      evidenceQuote: item.evidenceQuote,
      durability: item.durability,
      evidenceKind: item.evidenceKind,
      acceptedEvidence,
    });
    if (!admission.accepted || !admission.span || isOneOffTaskContent(content)) {
      counts.skippedCount += 1;
      logMemorySkip(admission.reason ?? "one_off_task", content);
      continue;
    }
    const durability = item.durability as MemoryDurability;
    const retrievalMode = resolveAutomaticRetrievalMode({
      category,
      memoryType,
      durability,
      content,
    });
    const isExplicitRequest = isExplicitMemoryInstruction(args.userMessageContent);
    const importanceScore = Math.max(
      normalizeMemoryScore(item.importanceScore, lifecycle.importanceScore),
      isExplicitRequest ? 0.8 : 0,
    );
    const confidenceScore = Math.max(
      normalizeMemoryScore(item.confidenceScore, lifecycle.confidenceScore),
      isExplicitRequest ? 0.8 : 0,
    );
    if (importanceScore < MIN_IMPORTANCE_SCORE || confidenceScore < MIN_CONFIDENCE_SCORE) {
      counts.skippedCount += 1;
      logMemorySkip(
        importanceScore < MIN_IMPORTANCE_SCORE ? "low_importance" : "low_confidence",
        content,
      );
      continue;
    }
    acceptedEvidence.push(admission.span);

    const now = Date.now();
    const modelExpiresAt = resolveExpiresAt(item, lifecycle.expiresAt, now);
    const policyExpiresAt = expiryForDurability(durability, now);
    const expiresAt = policyExpiresAt == null
      ? modelExpiresAt
      : Math.min(modelExpiresAt ?? policyExpiresAt, policyExpiresAt);
    const duplicate = findDuplicateMemory(content, existingMemories) as {
      _id?: Id<"memories">;
    } | null;
    if (duplicate?._id) {
      await ctx.runMutation(internal.chat.mutations.reinforceMemory, {
        memoryId: duplicate._id,
        reinforcedAt: now,
        candidateMemoryType: memoryType,
        candidateImportanceScore: importanceScore,
        candidateConfidenceScore: confidenceScore,
        candidateExpiresAt: expiresAt,
        candidateRetrievalMode: retrievalMode,
      });
      counts.reinforcedCount += 1;
      logMemorySkip("duplicate_reinforced", content);
      continue;
    }
    if (isDuplicateMemory(content, existingMemories)) {
      counts.skippedCount += 1;
      logMemorySkip("duplicate", content);
      continue;
    }

    const conflicting = findConflictingMemory(
      content,
      lifecycle.memoryType,
      existingMemories.filter((memory) => isMemoryActive(memory)),
    );
    if (conflicting?._id) {
      await ctx.runMutation(internal.chat.mutations.supersedeMemory, {
        memoryId: conflicting._id as Id<"memories">,
        supersededAt: now,
      });
      counts.supersededCount += 1;
    }

    const memoryId = await ctx.runMutation(internal.chat.mutations.createMemory, {
      userId: args.userId,
      content,
      category,
      memoryType,
      retrievalMode,
      importanceScore,
      confidenceScore,
      reinforcementCount: 1,
      lastReinforcedAt: now,
      expiresAt,
      supersedesMemoryId: conflicting?._id as Id<"memories"> | undefined,
      sourceMessageId: args.userMessageId,
      sourceChatId: args.chatId,
      sourceType: "chat",
      tags: item.tags,
      isPending: args.isPending ?? false,
      createdAt: now,
    });
    existingMemories.unshift(normalizeMemoryRecord({
      _id: memoryId,
      content,
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
    counts.createdCount += 1;
    await ctx.runMutation(internal.execution.workload_queues.enqueueMemoryEmbedding, {
      memoryId,
      content,
    });
    counts.embeddingScheduledCount += 1;
  }
  return counts;
}
