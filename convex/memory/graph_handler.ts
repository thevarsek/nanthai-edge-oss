import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { ConvexError } from "convex/values";
import { requireAuth, requirePro } from "../lib/auth";
import {
  deduplicateGraphEdges,
  GRAPH_ACTIVE_NODE_LIMIT,
  GRAPH_CANDIDATE_LIMIT,
  GRAPH_EDGE_LIMIT,
  GRAPH_EDGE_SCAN_LIMIT,
  GRAPH_NEIGHBOR_LIMIT,
  GRAPH_NODE_LIMIT,
  isGraphVisibleMemory,
  matchesGraphFilters,
  rankGraphMemories,
  toGraphNode,
  type MemoryGraphArgs,
  type MemoryGraphProjection,
} from "./graph_types";

function isNotNull<T>(value: T | null): value is T {
  return value !== null;
}

async function loadOwnedMemories(
  ctx: QueryCtx,
  ids: Id<"memories">[],
  userId: string,
): Promise<Doc<"memories">[]> {
  const uniqueIds = [...new Set(ids)].slice(0, GRAPH_NODE_LIMIT);
  const rows = await Promise.all(uniqueIds.map(async (id) => {
    const memory = await ctx.db.get(id);
    return memory?.userId === userId ? memory : null;
  }));
  return rows.filter(isNotNull);
}

async function projectAll(
  ctx: QueryCtx,
  args: MemoryGraphArgs,
  userId: string,
  now: number,
): Promise<MemoryGraphProjection> {
  const candidates = await ctx.db
    .query("memories")
    .withIndex("by_user", (query) => query.eq("userId", userId))
    .order("desc")
    .take(GRAPH_CANDIDATE_LIMIT + 1);
  const active = rankGraphMemories(candidates
    .slice(0, GRAPH_CANDIDATE_LIMIT)
    .filter((memory) => isGraphVisibleMemory(memory, now, false))
    .filter((memory) => matchesGraphFilters(memory, args)));
  const primary = active.slice(0, GRAPH_ACTIVE_NODE_LIMIT);
  const primaryIds = new Set(primary.map((memory) => memory._id));
  const relationships = await ctx.db
    .query("memoryRelationships")
    .withIndex("by_user", (query) => query.eq("userId", userId))
    .order("desc")
    .take(GRAPH_EDGE_SCAN_LIMIT + 1);
  const historyIds = relationships
    .slice(0, GRAPH_EDGE_SCAN_LIMIT)
    .filter((relationship) =>
      relationship.relationType === "supersedes"
      && primaryIds.has(relationship.fromMemoryId)
      && !primaryIds.has(relationship.toMemoryId)
    )
    .map((relationship) => relationship.toMemoryId);
  const uniqueHistoryIds = [...new Set(historyIds)];
  const eligibleHistory = (await loadOwnedMemories(ctx, uniqueHistoryIds, userId))
    .filter((memory) => memory.isSuperseded === true)
    .filter((memory) => isGraphVisibleMemory(memory, now, true));
  const historyLimit = GRAPH_NODE_LIMIT - primary.length;
  const history = eligibleHistory.slice(0, historyLimit);
  const nodes = [...primary, ...history];
  const nodeIds = new Set(nodes.map((memory) => memory._id));
  const eligibleEdges = deduplicateGraphEdges(
    relationships.slice(0, GRAPH_EDGE_SCAN_LIMIT),
    nodeIds,
  );

  return {
    mode: "all",
    nodes: nodes.map(toGraphNode),
    edges: eligibleEdges.slice(0, GRAPH_EDGE_LIMIT),
    truncated: {
      candidates: candidates.length > GRAPH_CANDIDATE_LIMIT,
      nodes: active.length > primary.length
        || uniqueHistoryIds.length > GRAPH_NODE_LIMIT
        || eligibleHistory.length > historyLimit,
      edges: relationships.length > GRAPH_EDGE_SCAN_LIMIT || eligibleEdges.length > GRAPH_EDGE_LIMIT,
    },
  };
}

async function projectNeighborhood(
  ctx: QueryCtx,
  args: MemoryGraphArgs,
  userId: string,
  now: number,
): Promise<MemoryGraphProjection> {
  if (!args.selectedMemoryId) {
    throw new ConvexError({
      code: "VALIDATION",
      message: "selectedMemoryId is required for neighborhood mode",
    });
  }
  const selected = await ctx.db.get(args.selectedMemoryId);
  if (
    !selected
    || selected.userId !== userId
    || !isGraphVisibleMemory(selected, now, selected.isSuperseded === true)
  ) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Memory not found" });
  }
  const [outgoing, incoming] = await Promise.all([
    ctx.db.query("memoryRelationships")
      .withIndex("by_user_from", (query) =>
        query.eq("userId", userId).eq("fromMemoryId", selected._id)
      )
      .take(GRAPH_NEIGHBOR_LIMIT + 1),
    ctx.db.query("memoryRelationships")
      .withIndex("by_user_to", (query) =>
        query.eq("userId", userId).eq("toMemoryId", selected._id)
      )
      .take(GRAPH_NEIGHBOR_LIMIT + 1),
  ]);
  const relationships = [...outgoing.slice(0, GRAPH_NEIGHBOR_LIMIT), ...incoming.slice(0, GRAPH_NEIGHBOR_LIMIT)];
  const neighborIds = relationships.flatMap((relationship) => [
    relationship.fromMemoryId,
    relationship.toMemoryId,
  ]);
  const loaded = await loadOwnedMemories(ctx, [selected._id, ...neighborIds], userId);
  const relationshipByEndpoint = new Map<Id<"memories">, Doc<"memoryRelationships">[]>();
  for (const relationship of relationships) {
    for (const endpoint of [relationship.fromMemoryId, relationship.toMemoryId]) {
      const current = relationshipByEndpoint.get(endpoint) ?? [];
      current.push(relationship);
      relationshipByEndpoint.set(endpoint, current);
    }
  }
  const nodes = loaded.filter((memory) => {
    if (memory._id === selected._id) return true;
    const allowsHistory = (relationshipByEndpoint.get(memory._id) ?? [])
      .some((relationship) => relationship.relationType === "supersedes");
    return isGraphVisibleMemory(memory, now, allowsHistory)
      && (memory.isSuperseded === true || matchesGraphFilters(memory, args));
  });
  const nodeIds = new Set(nodes.map((memory) => memory._id));
  const edges = deduplicateGraphEdges(relationships, nodeIds);
  return {
    mode: "neighborhood",
    nodes: nodes.map(toGraphNode),
    edges: edges.slice(0, GRAPH_EDGE_LIMIT),
    truncated: {
      candidates: outgoing.length > GRAPH_NEIGHBOR_LIMIT || incoming.length > GRAPH_NEIGHBOR_LIMIT,
      nodes: loaded.length > nodes.length,
      edges: edges.length > GRAPH_EDGE_LIMIT,
    },
  };
}

export async function getMemoryGraphHandler(
  ctx: QueryCtx,
  args: MemoryGraphArgs,
): Promise<MemoryGraphProjection> {
  const { userId } = await requireAuth(ctx);
  await requirePro(ctx, userId);
  const now = Date.now();
  return args.mode === "neighborhood"
    ? projectNeighborhood(ctx, args, userId, now)
    : projectAll(ctx, args, userId, now);
}
