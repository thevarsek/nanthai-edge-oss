import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  isMemoryActive,
  normalizeMemoryRecord,
} from "./shared";
import type {
  MemoryRelationshipSource,
  MemoryRelationshipType,
  RelationshipCandidate,
  RelationshipWrite,
} from "./relationship_handlers";

const CANDIDATE_LIMIT = 24;
const RELATIONSHIP_LIMIT = 8;
const RELATED_THRESHOLD = 0.72;
const SAME_CATEGORY_THRESHOLD = 0.62;
const SHARED_TAG_THRESHOLD = 0.35;

function sharedTags(left: string[], right: string[]): string[] {
  const rightTags = new Set(right.map((tag) => tag.toLowerCase()));
  return left.filter((tag) => rightTags.has(tag.toLowerCase())).slice(0, 5);
}

function relationshipForCandidate(
  memory: RelationshipCandidate,
  candidate: RelationshipCandidate,
): RelationshipWrite | null {
  if (!isMemoryActive(candidate)) return null;
  const source = normalizeMemoryRecord(memory);
  const target = normalizeMemoryRecord(candidate);
  const tags = sharedTags(source.tags, target.tags);
  let relationType: MemoryRelationshipType;
  let relationshipSource: MemoryRelationshipSource;
  let confidence = candidate.score;

  if (tags.length > 0 && candidate.score >= SHARED_TAG_THRESHOLD) {
    relationType = "sameTopic";
    relationshipSource = "metadata";
    confidence = Math.max(candidate.score, 0.8);
  } else if (
    source.category === target.category &&
    candidate.score >= SAME_CATEGORY_THRESHOLD
  ) {
    relationType = "sameTopic";
    relationshipSource = "metadata";
  } else if (candidate.score >= RELATED_THRESHOLD) {
    relationType = "related";
    relationshipSource = "embedding";
  } else {
    return null;
  }

  return {
    toMemoryId: candidate._id,
    relationType,
    source: relationshipSource,
    confidence,
    sharedTags: tags.length > 0 ? tags : undefined,
  };
}

export async function rebuildForMemoryHandler(
  ctx: ActionCtx,
  args: { memoryId: Id<"memories"> },
): Promise<number> {
  const input = await ctx.runQuery(
    internal.memory.relationships.getBuildInput,
    args,
  );
  if (!input) return 0;
  if (!input.embedding) {
    await ctx.runMutation(internal.execution.workload_queues.enqueueMemoryEmbedding, {
      memoryId: input.memory._id,
      content: input.memory.content,
    });
    return 0;
  }

  const results = await ctx.vectorSearch("memoryEmbeddings", "by_embedding", {
    vector: input.embedding,
    limit: CANDIDATE_LIMIT,
    filter: (query) => query.eq("userId", input.memory.userId),
  });
  const candidates = await ctx.runQuery(
    internal.memory.relationships.hydrateCandidates,
    {
      userId: input.memory.userId,
      hits: results.map((result) => ({
        embeddingId: result._id,
        score: result._score,
      })),
    },
  ) as RelationshipCandidate[];
  const sourceCandidate: RelationshipCandidate = {
    ...input.memory,
    score: 1,
  };
  const relationships = candidates
    .filter((candidate) => candidate._id !== input.memory._id)
    .map((candidate) => relationshipForCandidate(sourceCandidate, candidate))
    .filter((relationship): relationship is RelationshipWrite => relationship !== null)
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, RELATIONSHIP_LIMIT);

  if (input.supersededMemory) {
    relationships.unshift({
      toMemoryId: input.supersededMemory._id,
      relationType: "supersedes",
      source: "lifecycle",
      confidence: 1,
    });
  }

  return await ctx.runMutation(
    internal.memory.relationships.replaceForMemory,
    {
      memoryId: input.memory._id,
      userId: input.memory.userId,
      relationships,
      builtAt: Date.now(),
    },
  );
}

export async function backfillAllRelationshipsHandler(
  ctx: ActionCtx,
): Promise<{ scheduled: number }> {
  let cursor: string | undefined;
  let scheduled = 0;
  do {
    const page: {
      memoryIds: Id<"memories">[];
      nextCursor?: string;
      isDone: boolean;
    } = await ctx.runQuery(internal.memory.relationships.getBackfillPage, { cursor });
    for (const memoryId of page.memoryIds) {
      await ctx.runMutation(
        internal.execution.workload_queues.enqueueMemoryRelationship,
        { memoryId },
      );
      scheduled += 1;
    }
    cursor = page.nextCursor;
    if (page.isDone) break;
  } while (cursor !== undefined);
  return { scheduled };
}
