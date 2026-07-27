import { v } from "convex/values";
import { query } from "../_generated/server";
import { memoryCategory, memoryRetrievalMode } from "../schema_validators";
import { getMemoryGraphHandler } from "./graph_handler";

const graphMode = v.union(v.literal("all"), v.literal("neighborhood"));
const graphNode = v.object({
  id: v.id("memories"),
  content: v.string(),
  category: memoryCategory,
  retrievalMode: memoryRetrievalMode,
  tags: v.array(v.string()),
  importanceScore: v.number(),
  reinforcementCount: v.number(),
  lastReinforcedAt: v.optional(v.number()),
  updatedAt: v.number(),
  isSuperseded: v.boolean(),
  supersededByMemoryId: v.optional(v.id("memories")),
});
const graphEdge = v.object({
  id: v.id("memoryRelationships"),
  sourceId: v.id("memories"),
  targetId: v.id("memories"),
  kind: v.union(v.literal("related"), v.literal("sameTopic"), v.literal("supersedes")),
  confidence: v.number(),
});

export const get = query({
  args: {
    mode: graphMode,
    selectedMemoryId: v.optional(v.id("memories")),
    category: v.optional(memoryCategory),
    retrievalMode: v.optional(memoryRetrievalMode),
    text: v.optional(v.string()),
  },
  returns: v.object({
    mode: graphMode,
    nodes: v.array(graphNode),
    edges: v.array(graphEdge),
    truncated: v.object({
      candidates: v.boolean(),
      nodes: v.boolean(),
      edges: v.boolean(),
    }),
  }),
  handler: getMemoryGraphHandler,
});
