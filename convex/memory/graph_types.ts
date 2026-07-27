import type { Doc, Id } from "../_generated/dataModel";
import {
  isMemoryExpired,
  normalizeMemoryRecord,
  type MemoryCategory,
  type MemoryRetrievalMode,
} from "./shared";

export const GRAPH_CANDIDATE_LIMIT = 500;
export const GRAPH_ACTIVE_NODE_LIMIT = 225;
export const GRAPH_NODE_LIMIT = 250;
export const GRAPH_EDGE_LIMIT = 600;
export const GRAPH_EDGE_SCAN_LIMIT = 1_200;
export const GRAPH_NEIGHBOR_LIMIT = 60;

export type MemoryGraphMode = "all" | "neighborhood";

export interface MemoryGraphArgs extends Record<string, unknown> {
  mode: MemoryGraphMode;
  selectedMemoryId?: Id<"memories">;
  category?: MemoryCategory;
  retrievalMode?: MemoryRetrievalMode;
  text?: string;
}

export interface MemoryGraphNode {
  id: Id<"memories">;
  content: string;
  category: MemoryCategory;
  retrievalMode: MemoryRetrievalMode;
  tags: string[];
  importanceScore: number;
  reinforcementCount: number;
  lastReinforcedAt?: number;
  updatedAt: number;
  isSuperseded: boolean;
  supersededByMemoryId?: Id<"memories">;
}

export interface MemoryGraphEdge {
  id: Id<"memoryRelationships">;
  sourceId: Id<"memories">;
  targetId: Id<"memories">;
  kind: "related" | "sameTopic" | "supersedes";
  confidence: number;
}

export interface MemoryGraphProjection {
  mode: MemoryGraphMode;
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  truncated: {
    candidates: boolean;
    nodes: boolean;
    edges: boolean;
  };
}

export function isGraphVisibleMemory(
  memory: Doc<"memories">,
  now: number,
  allowSuperseded: boolean,
): boolean {
  if (memory.isPending || isMemoryExpired(memory, now)) return false;
  return allowSuperseded || !memory.isSuperseded;
}

export function matchesGraphFilters(
  memory: Doc<"memories">,
  args: MemoryGraphArgs,
): boolean {
  const normalized = normalizeMemoryRecord(memory);
  if (args.category && normalized.category !== args.category) return false;
  if (args.retrievalMode && normalized.retrievalMode !== args.retrievalMode) return false;
  const search = args.text?.trim().toLocaleLowerCase();
  if (!search) return true;
  return normalized.content.toLocaleLowerCase().includes(search)
    || normalized.tags.some((tag) => tag.toLocaleLowerCase().includes(search));
}

export function toGraphNode(memory: Doc<"memories">): MemoryGraphNode {
  const normalized = normalizeMemoryRecord(memory);
  return {
    id: memory._id,
    content: normalized.content,
    category: normalized.category,
    retrievalMode: normalized.retrievalMode,
    tags: normalized.tags,
    importanceScore: Math.max(0, Math.min(1, memory.importanceScore ?? 0)),
    reinforcementCount: Math.max(0, Math.floor(memory.reinforcementCount ?? 0)),
    lastReinforcedAt: memory.lastReinforcedAt,
    updatedAt: memory.updatedAt ?? memory.createdAt,
    isSuperseded: memory.isSuperseded === true,
    supersededByMemoryId: memory.supersededByMemoryId,
  };
}

export function rankGraphMemories(
  memories: Doc<"memories">[],
): Doc<"memories">[] {
  return memories.slice().sort((left, right) => {
    const importance = (right.importanceScore ?? 0) - (left.importanceScore ?? 0);
    if (importance !== 0) return importance;
    const reinforcement = (right.reinforcementCount ?? 0) - (left.reinforcementCount ?? 0);
    if (reinforcement !== 0) return reinforcement;
    const updated = (right.updatedAt ?? right.createdAt) - (left.updatedAt ?? left.createdAt);
    if (updated !== 0) return updated;
    return left._id.localeCompare(right._id);
  });
}

export function deduplicateGraphEdges(
  relationships: Doc<"memoryRelationships">[],
  nodeIds: Set<Id<"memories">>,
): MemoryGraphEdge[] {
  const strongest = new Map<string, MemoryGraphEdge>();
  for (const relationship of relationships) {
    if (!nodeIds.has(relationship.fromMemoryId) || !nodeIds.has(relationship.toMemoryId)) continue;
    const endpoints = relationship.relationType === "supersedes"
      ? `${relationship.fromMemoryId}:${relationship.toMemoryId}`
      : [relationship.fromMemoryId, relationship.toMemoryId].sort().join(":");
    const key = `${relationship.relationType}:${endpoints}`;
    const edge: MemoryGraphEdge = {
      id: relationship._id,
      sourceId: relationship.fromMemoryId,
      targetId: relationship.toMemoryId,
      kind: relationship.relationType,
      confidence: Math.max(0, Math.min(1, relationship.confidence)),
    };
    const existing = strongest.get(key);
    if (!existing || edge.confidence > existing.confidence) strongest.set(key, edge);
  }
  return [...strongest.values()].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind.localeCompare(right.kind);
    if (left.sourceId !== right.sourceId) return left.sourceId.localeCompare(right.sourceId);
    return left.targetId.localeCompare(right.targetId);
  });
}
