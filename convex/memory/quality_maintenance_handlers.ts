import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import {
  isEligibleExistingAlwaysOn,
  isExplicitMemoryInstruction,
  isGlobalPreferenceInstruction,
  isLikelyNonAssertiveUserMessage,
  isOneOffTaskContent,
  normalizeMemoryScore,
} from "./quality_policy";
import { isMemoryActive, normalizeMemoryRecord } from "./shared";

const PAGE_SIZE = 100;
const TASK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type QualityPatch = {
  memoryType?: "profile" | "responsePreference" | "workContext" | "transient";
  importanceScore?: number;
  confidenceScore?: number;
  retrievalMode?: "alwaysOn" | "contextual" | "disabled";
  expiresAt?: number;
  isSuperseded?: boolean;
  supersededByMemoryId?: Id<"memories">;
  supersededAt?: number;
  updatedAt?: number;
};

export interface MemoryQualityCounts {
  scannedCount: number;
  normalizedScoreCount: number;
  downgradedAlwaysOnCount: number;
  promotedAlwaysOnCount: number;
  taskExpiryCount: number;
  assistantDerivedDisabledCount: number;
  duplicateSupersededCount: number;
  isComplete: boolean;
  nextCursor?: string;
}

function compareCanonical(
  left: Doc<"memories">,
  right: Doc<"memories">,
): number {
  const fields = (memory: Doc<"memories">) => [
    memory.sourceType === "manual" ? 1 : 0,
    memory.isPinned ? 1 : 0,
    memory.reinforcementCount ?? 1,
    memory.updatedAt,
    memory.content.length,
  ];
  const leftFields = fields(left);
  const rightFields = fields(right);
  for (let index = 0; index < leftFields.length; index += 1) {
    if (leftFields[index] !== rightFields[index]) {
      return rightFields[index] - leftFields[index];
    }
  }
  return String(left._id).localeCompare(String(right._id));
}

function isDuplicateRelationship(
  relationship: Doc<"memoryRelationships">,
): boolean {
  if (relationship.relationType === "sameTopic") {
    return relationship.confidence >= 0.88;
  }
  return relationship.relationType === "related" && relationship.confidence >= 0.92;
}

function numericFactsCompatible(left: string, right: string): boolean {
  const facts = (value: string) => new Set(
    (value.match(/\b\d+(?:[.,]\d+)?%?\b/g) ?? [])
      .map((fact) => fact.replace(",", ".")),
  );
  const leftFacts = facts(left);
  const rightFacts = facts(right);
  if (leftFacts.size === 0 || rightFacts.size === 0) return true;
  return leftFacts.size === rightFacts.size &&
    [...leftFacts].every((fact) => rightFacts.has(fact));
}

async function findCanonicalDuplicate(
  ctx: MutationCtx,
  memory: Doc<"memories">,
): Promise<Doc<"memories"> | null> {
  if (!isMemoryActive(memory)) return null;
  const [outgoing, incoming] = await Promise.all([
    ctx.db.query("memoryRelationships")
      .withIndex("by_user_from", (query) =>
        query.eq("userId", memory.userId).eq("fromMemoryId", memory._id)
      ).take(12),
    ctx.db.query("memoryRelationships")
      .withIndex("by_user_to", (query) =>
        query.eq("userId", memory.userId).eq("toMemoryId", memory._id)
      ).take(12),
  ]);
  const candidateIds = new Set<Id<"memories">>();
  for (const relationship of [...outgoing, ...incoming]) {
    if (!isDuplicateRelationship(relationship)) continue;
    candidateIds.add(
      relationship.fromMemoryId === memory._id
        ? relationship.toMemoryId
        : relationship.fromMemoryId,
    );
  }
  const sourceCategory = normalizeMemoryRecord(memory).category;
  const candidates = await Promise.all(
    [...candidateIds].map((memoryId) => ctx.db.get(memoryId)),
  );
  const compatible = candidates.filter(
    (candidate): candidate is Doc<"memories"> =>
      candidate != null &&
      candidate.userId === memory.userId &&
      isMemoryActive(candidate) &&
      numericFactsCompatible(memory.content, candidate.content) &&
      normalizeMemoryRecord(candidate).category === sourceCategory,
  );
  if (compatible.length === 0) return null;
  const canonical = [memory, ...compatible].sort(compareCanonical)[0];
  return canonical._id === memory._id ? null : canonical;
}

export async function repairMemoryQualityPageHandler(
  ctx: MutationCtx,
  args: { cursor?: string; dryRun?: boolean },
): Promise<MemoryQualityCounts> {
  const page = await ctx.db.query("memories").paginate({
    cursor: args.cursor ?? null,
    numItems: PAGE_SIZE,
  });
  const now = Date.now();
  const counts: MemoryQualityCounts = {
    scannedCount: page.page.length,
    normalizedScoreCount: 0,
    downgradedAlwaysOnCount: 0,
    promotedAlwaysOnCount: 0,
    taskExpiryCount: 0,
    assistantDerivedDisabledCount: 0,
    duplicateSupersededCount: 0,
    isComplete: page.isDone,
    nextCursor: page.isDone ? undefined : page.continueCursor,
  };

  for (const memory of page.page) {
    const patch: QualityPatch = {};
    const isActive = isMemoryActive(memory);
    const importanceScore = normalizeMemoryScore(memory.importanceScore, 0.6);
    const confidenceScore = normalizeMemoryScore(memory.confidenceScore, 0.6);
    if (
      importanceScore !== memory.importanceScore ||
      confidenceScore !== memory.confidenceScore
    ) {
      patch.importanceScore = importanceScore;
      patch.confidenceScore = confidenceScore;
      counts.normalizedScoreCount += 1;
    }

    const normalized = normalizeMemoryRecord(memory);
    const sourceMessage = memory.sourceMessageId
      ? await ctx.db.get(memory.sourceMessageId)
      : null;
    if (
      isActive &&
      normalized.retrievalMode === "alwaysOn" &&
      !isEligibleExistingAlwaysOn({
        sourceType: normalized.sourceType,
        isPinned: memory.isPinned,
        category: normalized.category,
        memoryType: memory.memoryType,
        content: memory.content,
      })
    ) {
      patch.retrievalMode = "contextual";
      counts.downgradedAlwaysOnCount += 1;
    } else if (
      isActive &&
      normalized.retrievalMode === "contextual" &&
      normalized.sourceType === "chat" &&
      sourceMessage?.role === "user" &&
      isExplicitMemoryInstruction(sourceMessage.content) &&
      isGlobalPreferenceInstruction(sourceMessage.content) &&
      isEligibleExistingAlwaysOn({
        sourceType: normalized.sourceType,
        isPinned: memory.isPinned,
        category: normalized.category,
        memoryType: "responsePreference",
        content: memory.content,
      })
    ) {
      patch.memoryType = "responsePreference";
      patch.retrievalMode = "alwaysOn";
      counts.promotedAlwaysOnCount += 1;
    }

    if (
      isActive &&
      normalized.sourceType === "chat" &&
      isOneOffTaskContent(memory.content)
    ) {
      const taskExpiry = memory.createdAt + TASK_TTL_MS;
      if (normalized.retrievalMode !== "disabled") {
        patch.retrievalMode = "contextual";
      }
      if (memory.expiresAt == null || memory.expiresAt > taskExpiry) {
        patch.expiresAt = taskExpiry;
        counts.taskExpiryCount += 1;
      }
    }

    if (
      isActive &&
      normalized.sourceType === "chat" &&
      (memory.reinforcementCount ?? 1) <= 1 &&
      sourceMessage?.role === "user" &&
      isLikelyNonAssertiveUserMessage(sourceMessage.content)
    ) {
      patch.retrievalMode = "disabled";
      patch.expiresAt = Math.min(patch.expiresAt ?? now, now);
      counts.assistantDerivedDisabledCount += 1;
    }

    const canonical = await findCanonicalDuplicate(ctx, memory);
    if (canonical) {
      patch.isSuperseded = true;
      patch.supersededByMemoryId = canonical._id;
      patch.supersededAt = now;
      patch.expiresAt = now;
      counts.duplicateSupersededCount += 1;
    }

    if (Object.keys(patch).length > 0 && !(args.dryRun ?? false)) {
      patch.updatedAt = now;
      await ctx.db.patch(memory._id, patch);
    }
  }

  return counts;
}

export async function runMemoryQualitySweepHandler(
  ctx: ActionCtx,
  args: { dryRun?: boolean },
): Promise<Omit<MemoryQualityCounts, "isComplete" | "nextCursor">> {
  const total = {
    scannedCount: 0,
    normalizedScoreCount: 0,
    downgradedAlwaysOnCount: 0,
    promotedAlwaysOnCount: 0,
    taskExpiryCount: 0,
    assistantDerivedDisabledCount: 0,
    duplicateSupersededCount: 0,
  };
  let cursor: string | undefined;
  do {
    const result: MemoryQualityCounts = await ctx.runMutation(
      internal.memory.quality.repairPage,
      { cursor, dryRun: args.dryRun },
    );
    total.scannedCount += result.scannedCount;
    total.normalizedScoreCount += result.normalizedScoreCount;
    total.downgradedAlwaysOnCount += result.downgradedAlwaysOnCount;
    total.promotedAlwaysOnCount += result.promotedAlwaysOnCount;
    total.taskExpiryCount += result.taskExpiryCount;
    total.assistantDerivedDisabledCount += result.assistantDerivedDisabledCount;
    total.duplicateSupersededCount += result.duplicateSupersededCount;
    cursor = result.nextCursor;
    if (result.isComplete) break;
  } while (cursor !== undefined);
  return total;
}
