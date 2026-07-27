import { describe, expect, it } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import {
  graphNodeRadius,
  layoutMemoryGraph,
  MEMORY_GRAPH_HEIGHT,
  MEMORY_GRAPH_WIDTH,
  type MemoryGraphLayoutNode,
} from "./MemoryGraphLayout";

const nodes: MemoryGraphLayoutNode[] = [
  {
    id: "memory_a" as Id<"memories">,
    category: "work",
    retrievalMode: "contextual",
    importanceScore: 0.9,
    reinforcementCount: 4,
    isSuperseded: false,
  },
  {
    id: "memory_b" as Id<"memories">,
    category: "preferences",
    retrievalMode: "alwaysOn",
    importanceScore: 0.4,
    reinforcementCount: 1,
    isSuperseded: false,
  },
  {
    id: "memory_c" as Id<"memories">,
    category: "tools",
    retrievalMode: "disabled",
    importanceScore: 0.1,
    reinforcementCount: 0,
    isSuperseded: true,
  },
];

const edges = [
  { sourceId: nodes[0]!.id, targetId: nodes[1]!.id, confidence: 0.9 },
  { sourceId: nodes[1]!.id, targetId: nodes[2]!.id, confidence: 0.7 },
];

describe("MemoryGraphLayout", () => {
  it("produces deterministic bounded positions", () => {
    const first = layoutMemoryGraph(nodes, edges);
    const second = layoutMemoryGraph(nodes, edges);
    expect(first).toEqual(second);
    expect(first).toHaveLength(nodes.length);
    for (const node of first) {
      expect(node.x).toBeGreaterThanOrEqual(24);
      expect(node.x).toBeLessThanOrEqual(MEMORY_GRAPH_WIDTH - 24);
      expect(node.y).toBeGreaterThanOrEqual(24);
      expect(node.y).toBeLessThanOrEqual(MEMORY_GRAPH_HEIGHT - 24);
    }
  });

  it("uses restrained bounded size encoding", () => {
    expect(graphNodeRadius(nodes[0]!)).toBeGreaterThan(graphNodeRadius(nodes[2]!));
    expect(graphNodeRadius(nodes[0]!)).toBeLessThanOrEqual(12);
    expect(graphNodeRadius(nodes[2]!)).toBeGreaterThanOrEqual(3.5);
  });
});
