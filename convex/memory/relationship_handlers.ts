import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  isMemoryActive,
  normalizeMemoryRecord,
  type MemoryRecordLike,
} from "./shared";

export type MemoryRelationshipType = "related" | "sameTopic" | "supersedes";
export type MemoryRelationshipSource = "embedding" | "metadata" | "lifecycle";

export interface RelationshipWrite {
  toMemoryId: Id<"memories">;
  relationType: MemoryRelationshipType;
  source: MemoryRelationshipSource;
  confidence: number;
  sharedTags?: string[];
}

export interface RelationshipCandidate extends MemoryRecordLike {
  _id: Id<"memories">;
  userId: string;
  score: number;
}

export async function getRelationshipBackfillPageHandler(
  ctx: QueryCtx,
  args: { cursor?: string },
): Promise<{ memoryIds: Id<"memories">[]; nextCursor?: string; isDone: boolean }> {
  const page = await ctx.db.query("memories").paginate({
    cursor: args.cursor ?? null,
    numItems: 100,
  });
  return {
    memoryIds: page.page.map((memory) => memory._id),
    nextCursor: page.isDone ? undefined : page.continueCursor,
    isDone: page.isDone,
  };
}

function isNotNull<T>(value: T | null): value is T {
  return value !== null;
}

export async function getRelationshipBuildInputHandler(
  ctx: QueryCtx,
  args: { memoryId: Id<"memories"> },
): Promise<{
  memory: Doc<"memories">;
  embedding: number[] | null;
  supersededMemory: Doc<"memories"> | null;
} | null> {
  const memory = await ctx.db.get(args.memoryId);
  if (!memory) return null;
  const embeddingRow = await ctx.db
    .query("memoryEmbeddings")
    .withIndex("by_memory", (query) => query.eq("memoryId", memory._id))
    .first();
  const supersededMemory = memory.supersedesMemoryId
    ? await ctx.db.get(memory.supersedesMemoryId)
    : null;
  return {
    memory,
    embedding: embeddingRow?.userId === memory.userId ? embeddingRow.embedding : null,
    supersededMemory:
      supersededMemory?.userId === memory.userId ? supersededMemory : null,
  };
}

export async function hydrateRelationshipCandidatesHandler(
  ctx: QueryCtx,
  args: {
    userId: string;
    hits: Array<{ embeddingId: Id<"memoryEmbeddings">; score: number }>;
  },
): Promise<RelationshipCandidate[]> {
  const candidates = await Promise.all(args.hits.map(
    async (hit): Promise<RelationshipCandidate | null> => {
      const embedding = await ctx.db.get(hit.embeddingId);
      if (!embedding || embedding.userId !== args.userId) return null;
      const memory = await ctx.db.get(embedding.memoryId);
      if (!memory || memory.userId !== args.userId) return null;
      return { ...memory, score: hit.score };
    },
  ));
  return candidates.filter(isNotNull);
}

export async function replaceRelationshipsForMemoryHandler(
  ctx: MutationCtx,
  args: {
    memoryId: Id<"memories">;
    userId: string;
    relationships: RelationshipWrite[];
    builtAt: number;
  },
): Promise<number> {
  const memory = await ctx.db.get(args.memoryId);
  if (!memory || memory.userId !== args.userId) return 0;

  const existing = await ctx.db
    .query("memoryRelationships")
    .withIndex("by_user_from", (query) =>
      query.eq("userId", args.userId).eq("fromMemoryId", args.memoryId)
    )
    .collect();
  for (const relationship of existing) await ctx.db.delete(relationship._id);

  let inserted = 0;
  for (const relationship of args.relationships) {
    if (relationship.toMemoryId === args.memoryId) continue;
    const target = await ctx.db.get(relationship.toMemoryId);
    if (!target || target.userId !== args.userId) continue;
    await ctx.db.insert("memoryRelationships", {
      userId: args.userId,
      fromMemoryId: args.memoryId,
      toMemoryId: relationship.toMemoryId,
      relationType: relationship.relationType,
      source: relationship.source,
      confidence: Math.max(0, Math.min(1, relationship.confidence)),
      sharedTags: relationship.sharedTags,
      createdAt: args.builtAt,
      updatedAt: args.builtAt,
    });
    inserted += 1;
  }

  const normalized = normalizeMemoryRecord(memory);
  await ctx.db.patch(memory._id, {
    category: normalized.category,
    retrievalMode: normalized.retrievalMode,
    scopeType: normalized.scopeType,
    personaIds: normalized.personaIds,
    sourceType: normalized.sourceType,
    tags: normalized.tags,
    relationshipsBuiltAt: args.builtAt,
  });
  return inserted;
}

interface GraphHit extends Doc<"memories"> {
  retrievalScore: number;
  retrievalKind: "vector" | "graph";
  relationshipType?: "related" | "sameTopic";
}

function isContextualCandidate(memory: Doc<"memories">): boolean {
  return isMemoryActive(memory) &&
    normalizeMemoryRecord(memory).retrievalMode !== "disabled";
}

export async function hydrateRelevantHitsHandler(
  ctx: QueryCtx,
  args: {
    userId: string;
    hits: Array<{ embeddingId: Id<"memoryEmbeddings">; score: number }>;
  },
): Promise<GraphHit[]> {
  const hydratedSeeds = await Promise.all(args.hits.map(
    async (hit): Promise<GraphHit | null> => {
      const embedding = await ctx.db.get(hit.embeddingId);
      if (!embedding || embedding.userId !== args.userId) return null;
      const memory = await ctx.db.get(embedding.memoryId);
      if (!memory || memory.userId !== args.userId || !isContextualCandidate(memory)) {
        return null;
      }
      return {
        ...memory,
        retrievalScore: Math.max(0, Math.min(1, hit.score)),
        retrievalKind: "vector" as const,
      };
    },
  ));
  const seeds = hydratedSeeds.filter(isNotNull);

  const seedIds = new Set(seeds.map((memory) => memory._id));
  const relationshipGroups = await Promise.all(seeds.slice(0, 5).map(async (seed) => {
    const [outgoing, incoming] = await Promise.all([
      ctx.db.query("memoryRelationships")
        .withIndex("by_user_from", (query) =>
          query.eq("userId", args.userId).eq("fromMemoryId", seed._id)
        ).take(8),
      ctx.db.query("memoryRelationships")
        .withIndex("by_user_to", (query) =>
          query.eq("userId", args.userId).eq("toMemoryId", seed._id)
        ).take(8),
    ]);
    return { seed, relationships: [...outgoing, ...incoming] };
  }));
  const proposals = new Map<Id<"memories">, {
    retrievalScore: number;
    relationshipType: "related" | "sameTopic";
  }>();
  for (const { seed, relationships } of relationshipGroups) {
    for (const relationship of relationships) {
      if (relationship.relationType === "supersedes") continue;
      const candidateId = relationship.fromMemoryId === seed._id
        ? relationship.toMemoryId
        : relationship.fromMemoryId;
      if (seedIds.has(candidateId)) continue;
      const retrievalScore = seed.retrievalScore * relationship.confidence * 0.9;
      const existing = proposals.get(candidateId);
      if (existing && existing.retrievalScore >= retrievalScore) continue;
      proposals.set(candidateId, {
        retrievalScore,
        relationshipType: relationship.relationType,
      });
    }
  }
  const graphCandidates = await Promise.all(
    [...proposals.entries()]
      .sort((left, right) => right[1].retrievalScore - left[1].retrievalScore)
      .slice(0, 24)
      .map(async ([memoryId, proposal]): Promise<GraphHit | null> => {
        const memory = await ctx.db.get(memoryId);
        if (!memory || memory.userId !== args.userId || !isContextualCandidate(memory)) {
          return null;
        }
        return {
          ...memory,
          ...proposal,
          retrievalKind: "graph",
        };
      }),
  );

  return [
    ...seeds,
    ...graphCandidates
      .filter(isNotNull)
      .sort((left, right) => right.retrievalScore - left.retrievalScore)
      .slice(0, 8),
  ];
}
