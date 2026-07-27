import assert from "node:assert/strict";
import test from "node:test";
import type { Doc, Id } from "../_generated/dataModel";
import {
  deduplicateGraphEdges,
  matchesGraphFilters,
  rankGraphMemories,
  toGraphNode,
} from "../memory/graph_types";
import { getMemoryGraphHandler } from "../memory/graph_handler";

function memory(
  id: string,
  overrides: Partial<Doc<"memories">> = {},
): Doc<"memories"> {
  return {
    _id: id as Id<"memories">,
    _creationTime: 1,
    userId: "user_1",
    content: "Prefers concise answers",
    tags: ["communication"],
    category: "writingStyle",
    retrievalMode: "alwaysOn",
    isPinned: false,
    isPending: false,
    accessCount: 0,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function relationship(
  id: string,
  from: string,
  to: string,
  kind: "related" | "sameTopic" | "supersedes",
  confidence: number,
): Doc<"memoryRelationships"> {
  return {
    _id: id as Id<"memoryRelationships">,
    _creationTime: 1,
    userId: "user_1",
    fromMemoryId: from as Id<"memories">,
    toMemoryId: to as Id<"memories">,
    relationType: kind,
    source: "metadata",
    confidence,
    createdAt: 1,
    updatedAt: 1,
  };
}

test("graph filters use normalized category and literal content or tag matching", () => {
  const candidate = memory("memory_1");
  assert.equal(matchesGraphFilters(candidate, {
    mode: "all",
    category: "writingStyle",
    retrievalMode: "alwaysOn",
    text: "COMMUN",
  }), true);
  assert.equal(matchesGraphFilters(candidate, { mode: "all", text: "regex.*" }), false);
});

test("graph nodes clamp scores and normalize integer-like values", () => {
  const node = toGraphNode(memory("memory_1", {
    importanceScore: 9,
    reinforcementCount: 4.8,
  }));
  assert.equal(node.importanceScore, 1);
  assert.equal(node.reinforcementCount, 4);
  assert.equal(node.isSuperseded, false);
});

test("peer edges deduplicate by unordered endpoints while supersedes stays directed", () => {
  const ids = new Set([
    "memory_1" as Id<"memories">,
    "memory_2" as Id<"memories">,
  ]);
  const edges = deduplicateGraphEdges([
    relationship("edge_1", "memory_1", "memory_2", "related", 0.4),
    relationship("edge_2", "memory_2", "memory_1", "related", 0.9),
    relationship("edge_3", "memory_1", "memory_2", "supersedes", 1),
    relationship("edge_4", "memory_2", "memory_1", "supersedes", 1),
  ], ids);
  assert.equal(edges.length, 3);
  assert.equal(edges.find((edge) => edge.kind === "related")?.id, "edge_2");
  assert.equal(edges.filter((edge) => edge.kind === "supersedes").length, 2);
});

test("graph ranking is stable across importance, reinforcement, update, and id", () => {
  const ranked = rankGraphMemories([
    memory("memory_c", { importanceScore: 0.7, reinforcementCount: 2, updatedAt: 3 }),
    memory("memory_a", { importanceScore: 0.8, reinforcementCount: 1 }),
    memory("memory_b", { importanceScore: 0.7, reinforcementCount: 4 }),
  ]);
  assert.deepEqual(ranked.map((item) => item._id), ["memory_a", "memory_b", "memory_c"]);
});

test("graph projection returns only the authenticated user's indexed data", async () => {
  const projection = await getMemoryGraphHandler({
    auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          first: async () => table === "purchaseEntitlements" ? { status: "active" } : null,
          order: () => ({
            take: async () => table === "memories"
              ? [memory("memory_owned"), memory("memory_pending", { isPending: true })]
              : [],
          }),
        }),
      }),
    },
  } as never, { mode: "all" });

  assert.deepEqual(projection.nodes.map((node) => node.id), ["memory_owned"]);
  assert.deepEqual(projection.edges, []);
});

test("neighborhood projection treats a foreign selected memory as not found", async () => {
  await assert.rejects(
    getMemoryGraphHandler({
      auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
      db: {
        get: async () => memory("memory_foreign", { userId: "user_2" }),
        query: (table: string) => ({
          withIndex: () => ({
            first: async () => table === "purchaseEntitlements" ? { status: "active" } : null,
          }),
        }),
      },
    } as never, {
      mode: "neighborhood",
      selectedMemoryId: "memory_foreign" as Id<"memories">,
    }),
    (error: unknown) => {
      assert.equal((error as { data?: { code?: string } }).data?.code, "NOT_FOUND");
      return true;
    },
  );
});
