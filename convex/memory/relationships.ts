import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAuth, requirePro } from "../lib/auth";
import {
  backfillAllRelationshipsHandler,
  rebuildForMemoryHandler,
} from "./relationship_actions";
import {
  getRelationshipBackfillPageHandler,
  getRelationshipBuildInputHandler,
  hydrateRelationshipCandidatesHandler,
  hydrateRelevantHitsHandler,
  replaceRelationshipsForMemoryHandler,
} from "./relationship_handlers";

const relationshipHit = v.object({
  embeddingId: v.id("memoryEmbeddings"),
  score: v.number(),
});

export const getBuildInput = internalQuery({
  args: { memoryId: v.id("memories") },
  handler: getRelationshipBuildInputHandler,
});

export const getBackfillPage = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: getRelationshipBackfillPageHandler,
});

export const hydrateCandidates = internalQuery({
  args: { userId: v.string(), hits: v.array(relationshipHit) },
  handler: hydrateRelationshipCandidatesHandler,
});

export const hydrateRelevantHits = internalQuery({
  args: { userId: v.string(), hits: v.array(relationshipHit) },
  handler: hydrateRelevantHitsHandler,
});

export const replaceForMemory = internalMutation({
  args: {
    memoryId: v.id("memories"),
    userId: v.string(),
    relationships: v.array(v.object({
      toMemoryId: v.id("memories"),
      relationType: v.union(
        v.literal("related"),
        v.literal("sameTopic"),
        v.literal("supersedes"),
      ),
      source: v.union(
        v.literal("embedding"),
        v.literal("metadata"),
        v.literal("lifecycle"),
      ),
      confidence: v.number(),
      sharedTags: v.optional(v.array(v.string())),
    })),
    builtAt: v.number(),
  },
  handler: replaceRelationshipsForMemoryHandler,
});

export const rebuildForMemory = internalAction({
  args: { memoryId: v.id("memories") },
  handler: rebuildForMemoryHandler,
});

export const backfillAll = internalAction({
  args: {},
  handler: backfillAllRelationshipsHandler,
});

export const backfillMine = mutation({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    const memories = await ctx.db
      .query("memories")
      .withIndex("by_user", (query) => query.eq("userId", userId))
      .order("desc")
      .take(500);
    const candidates = memories.filter((memory) => memory.relationshipsBuiltAt == null);
    for (const memory of candidates) {
      await ctx.scheduler.runAfter(0, internal.memory.relationships.rebuildForMemory, {
        memoryId: memory._id,
      });
    }
    return { scheduled: candidates.length };
  },
});
