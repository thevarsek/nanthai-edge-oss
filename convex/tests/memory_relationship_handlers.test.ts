import assert from "node:assert/strict";
import test from "node:test";

import {
  hydrateRelationshipCandidatesHandler,
  hydrateRelevantHitsHandler,
  replaceRelationshipsForMemoryHandler,
} from "../memory/relationship_handlers";
import { rebuildForMemoryHandler } from "../memory/relationship_actions";

test("relationship candidate hydration never crosses users", async () => {
  const docs = new Map<string, Record<string, unknown>>([
    ["embedding_1", { _id: "embedding_1", memoryId: "memory_1", userId: "user_1" }],
    ["embedding_2", { _id: "embedding_2", memoryId: "memory_2", userId: "user_2" }],
    ["memory_1", { _id: "memory_1", content: "One", userId: "user_1" }],
    ["memory_2", { _id: "memory_2", content: "Two", userId: "user_2" }],
  ]);

  const result = await hydrateRelationshipCandidatesHandler({
    db: { get: async (id: string) => docs.get(id) ?? null },
  } as any, {
    userId: "user_1",
    hits: [
      { embeddingId: "embedding_1" as any, score: 0.9 },
      { embeddingId: "embedding_2" as any, score: 0.99 },
    ],
  });

  assert.deepEqual(result.map((memory) => memory._id), ["memory_1"]);
});

test("relationship writes reject cross-user targets", async () => {
  const inserted: Array<Record<string, unknown>> = [];
  const docs = new Map<string, Record<string, unknown>>([
    ["memory_1", { _id: "memory_1", content: "One", userId: "user_1" }],
    ["memory_same_user", {
      _id: "memory_same_user",
      content: "Same user",
      userId: "user_1",
    }],
    ["memory_other_user", {
      _id: "memory_other_user",
      content: "Other user",
      userId: "user_2",
    }],
  ]);

  const count = await replaceRelationshipsForMemoryHandler({
    db: {
      get: async (id: string) => docs.get(id) ?? null,
      query: () => ({
        withIndex: () => ({ collect: async () => [], unique: async () => null }),
      }),
      delete: async () => {},
      insert: async (_table: string, value: Record<string, unknown>) => {
        inserted.push(value);
      },
      patch: async () => {},
    },
  } as any, {
    memoryId: "memory_1" as any,
    userId: "user_1",
    relationships: [
      {
        toMemoryId: "memory_same_user" as any,
        relationType: "related",
        source: "embedding",
        confidence: 0.8,
      },
      {
        toMemoryId: "memory_other_user" as any,
        relationType: "related",
        source: "embedding",
        confidence: 0.99,
      },
    ],
    builtAt: 123,
  });

  assert.equal(count, 1);
  assert.equal(inserted[0]?.toMemoryId, "memory_same_user");
  assert.equal(inserted[0]?.userId, "user_1");
});

test("relevant-hit hydration expands one hop and filters unsafe candidates", async () => {
  const docs = new Map<string, Record<string, unknown>>([
    ["embedding_seed", {
      _id: "embedding_seed",
      memoryId: "memory_seed",
      userId: "user_1",
    }],
    ["memory_seed", {
      _id: "memory_seed",
      content: "Seed",
      userId: "user_1",
    }],
    ["memory_related", {
      _id: "memory_related",
      content: "Related",
      userId: "user_1",
    }],
    ["memory_pending", {
      _id: "memory_pending",
      content: "Pending",
      userId: "user_1",
      isPending: true,
    }],
    ["memory_other_user", {
      _id: "memory_other_user",
      content: "Private",
      userId: "user_2",
    }],
  ]);
  const outgoing = [
    {
      fromMemoryId: "memory_seed",
      toMemoryId: "memory_related",
      relationType: "related",
      confidence: 0.8,
    },
    {
      fromMemoryId: "memory_seed",
      toMemoryId: "memory_pending",
      relationType: "sameTopic",
      confidence: 0.9,
    },
    {
      fromMemoryId: "memory_seed",
      toMemoryId: "memory_other_user",
      relationType: "related",
      confidence: 1,
    },
  ];

  const result = await hydrateRelevantHitsHandler({
    db: {
      get: async (id: string) => docs.get(id) ?? null,
      query: () => ({
        withIndex: (index: string) => ({
          take: async () => index === "by_user_from" ? outgoing : [],
        }),
      }),
    },
  } as any, {
    userId: "user_1",
    hits: [{ embeddingId: "embedding_seed" as any, score: 0.9 }],
  });

  assert.deepEqual(result.map((memory) => memory._id), [
    "memory_seed",
    "memory_related",
  ]);
  assert.equal(result[0]?.retrievalKind, "vector");
  assert.equal(result[1]?.retrievalKind, "graph");
  assert.ok(Math.abs((result[1]?.retrievalScore ?? 0) - 0.648) < 0.000_001);
});

test("relationship rebuild derives metadata, semantic, and lifecycle edges", async () => {
  const mutationPayloads: Array<Record<string, unknown>> = [];
  let queryCount = 0;
  let vectorFilterUser: string | undefined;
  const count = await rebuildForMemoryHandler({
    runQuery: async () => {
      queryCount += 1;
      if (queryCount === 1) {
        return {
          memory: {
            _id: "memory_source",
            content: "Dino is building NanthAI.",
            userId: "user_1",
            category: "work",
            tags: ["NanthAI"],
          },
          embedding: [0.1, 0.2],
          supersededMemory: {
            _id: "memory_old",
            content: "Dino was building the old app.",
            userId: "user_1",
          },
        };
      }
      return [
        {
          _id: "memory_tagged",
          content: "NanthAI uses Convex.",
          userId: "user_1",
          category: "tools",
          tags: ["nanthai"],
          score: 0.5,
        },
        {
          _id: "memory_semantic",
          content: "A related product goal.",
          userId: "user_1",
          category: "goals",
          score: 0.75,
        },
      ];
    },
    vectorSearch: async (_table: string, _index: string, options: any) => {
      options.filter({
        eq: (_field: string, value: string) => {
          vectorFilterUser = value;
        },
      });
      return [
        { _id: "embedding_tagged", _score: 0.5 },
        { _id: "embedding_semantic", _score: 0.75 },
      ];
    },
    runMutation: async (_fn: unknown, payload: Record<string, unknown>) => {
      mutationPayloads.push(payload);
      return (payload.relationships as unknown[]).length;
    },
    scheduler: { runAfter: async () => {} },
  } as any, { memoryId: "memory_source" as any });

  const relationships = mutationPayloads[0]?.relationships as Array<{
    toMemoryId: string;
    relationType: string;
  }>;
  assert.equal(vectorFilterUser, "user_1");
  assert.equal(count, 3);
  assert.deepEqual(relationships.map((relationship) => [
    relationship.toMemoryId,
    relationship.relationType,
  ]), [
    ["memory_old", "supersedes"],
    ["memory_tagged", "sameTopic"],
    ["memory_semantic", "related"],
  ]);
});
