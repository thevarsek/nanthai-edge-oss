import assert from "node:assert/strict";
import test from "node:test";

import { repairMemoryQualityPageHandler } from "../memory/quality_maintenance_handlers";

function memory(overrides: Record<string, unknown> = {}) {
  return {
    _id: "memory_1",
    _creationTime: 1,
    userId: "user_1",
    content: "User uses many development tools.",
    category: "tools",
    memoryType: "profile",
    retrievalMode: "alwaysOn",
    scopeType: "allPersonas",
    personaIds: [],
    sourceType: "import",
    tags: [],
    importanceScore: 9,
    confidenceScore: 0.9,
    reinforcementCount: 1,
    isPinned: false,
    isPending: false,
    isSuperseded: false,
    accessCount: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function context(args: {
  pageMemory: Record<string, unknown>;
  relationships?: Record<string, unknown>[];
  documents?: Record<string, Record<string, unknown>>;
  patches: Array<{ id: string; patch: Record<string, unknown> }>;
}) {
  return {
    db: {
      query: (table: string) => {
        if (table === "memories") {
          return {
            paginate: async () => ({ page: [args.pageMemory], isDone: true }),
          };
        }
        return {
          withIndex: () => ({
            take: async () => args.relationships ?? [],
          }),
        };
      },
      get: async (id: string) => args.documents?.[id] ?? null,
      patch: async (id: string, patch: Record<string, unknown>) => {
        args.patches.push({ id, patch });
      },
    },
  };
}

test("quality repair clamps imported scores and downgrades non-core always-on memory", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const result = await repairMemoryQualityPageHandler(context({
    pageMemory: memory(),
    patches,
  }) as never, { dryRun: false });

  assert.equal(result.normalizedScoreCount, 1);
  assert.equal(result.downgradedAlwaysOnCount, 1);
  assert.equal(patches[0]?.patch.importanceScore, 0.9);
  assert.equal(patches[0]?.patch.retrievalMode, "contextual");
});

test("quality repair disables single-use assistant-derived task memories", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const task = memory({
    sourceType: "chat",
    sourceMessageId: "message_1",
    content: "User wants a 16-slide presentation.",
    category: "writingStyle",
    importanceScore: 0.9,
  });
  const result = await repairMemoryQualityPageHandler(context({
    pageMemory: task,
    documents: {
      message_1: { _id: "message_1", role: "user", content: "Create a 16-slide presentation." },
    },
    patches,
  }) as never, { dryRun: false });

  assert.equal(result.taskExpiryCount, 1);
  assert.equal(result.assistantDerivedDisabledCount, 1);
  assert.equal(patches[0]?.patch.retrievalMode, "disabled");
});

test("quality repair leaves previously disabled task memories unchanged", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const task = memory({
    sourceType: "chat",
    sourceMessageId: "message_1",
    content: "User wants a 16-slide presentation.",
    retrievalMode: "disabled",
    importanceScore: 0.9,
    expiresAt: Date.now() - 1,
  });
  const result = await repairMemoryQualityPageHandler(context({
    pageMemory: task,
    documents: {
      message_1: { _id: "message_1", role: "user", content: "Create a 16-slide presentation." },
    },
    patches,
  }) as never, { dryRun: false });

  assert.equal(result.taskExpiryCount, 0);
  assert.equal(result.assistantDerivedDisabledCount, 0);
  assert.deepEqual(patches, []);
});

test("quality repair promotes only explicitly global response preferences", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const preference = memory({
    sourceType: "chat",
    sourceMessageId: "message_1",
    content: "Prefiero respuestas concisas en todas las conversaciones.",
    category: "preferences",
    memoryType: "profile",
    retrievalMode: "contextual",
    importanceScore: 0.9,
  });
  const result = await repairMemoryQualityPageHandler(context({
    pageMemory: preference,
    documents: {
      message_1: {
        _id: "message_1",
        role: "user",
        content: "Recuerda esta preferencia global: prefiero respuestas concisas.",
      },
    },
    patches,
  }) as never, { dryRun: false });

  assert.equal(result.promotedAlwaysOnCount, 1);
  assert.equal(patches[0]?.patch.memoryType, "responsePreference");
  assert.equal(patches[0]?.patch.retrievalMode, "alwaysOn");
});

test("quality repair supersedes a weaker semantic duplicate without deleting it", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const weaker = memory({
    _id: "memory_weaker",
    sourceType: "chat",
    retrievalMode: "contextual",
    content: "I want to publish my AI views on LinkedIn.",
    category: "goals",
    importanceScore: 0.8,
  });
  const canonical = memory({
    _id: "memory_canonical",
    sourceType: "chat",
    retrievalMode: "contextual",
    content: "I want to publish nuanced AI and SaaS views on LinkedIn.",
    category: "goals",
    importanceScore: 0.9,
    reinforcementCount: 2,
    updatedAt: 2,
  });
  const relationship = {
    _id: "relationship_1",
    userId: "user_1",
    fromMemoryId: "memory_weaker",
    toMemoryId: "memory_canonical",
    relationType: "sameTopic",
    source: "embedding",
    confidence: 0.94,
    createdAt: 1,
    updatedAt: 1,
  };
  const result = await repairMemoryQualityPageHandler(context({
    pageMemory: weaker,
    relationships: [relationship],
    documents: { memory_canonical: canonical },
    patches,
  }) as never, { dryRun: false });

  assert.equal(result.duplicateSupersededCount, 1);
  assert.equal(patches[0]?.patch.isSuperseded, true);
  assert.equal(patches[0]?.patch.supersededByMemoryId, "memory_canonical");
});

test("quality repair preserves similar memories with conflicting numeric facts", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const current = memory({
    _id: "memory_current",
    retrievalMode: "contextual",
    content: "The intrinsic value is $261 while the market price is $447.",
    category: "goals",
    importanceScore: 0.8,
  });
  const other = memory({
    _id: "memory_other",
    retrievalMode: "contextual",
    content: "The intrinsic value is $288 while the market price is $447.",
    category: "goals",
    importanceScore: 0.9,
    reinforcementCount: 2,
  });
  const relationship = {
    _id: "relationship_1",
    userId: "user_1",
    fromMemoryId: "memory_current",
    toMemoryId: "memory_other",
    relationType: "sameTopic",
    source: "embedding",
    confidence: 0.96,
    createdAt: 1,
    updatedAt: 1,
  };
  const result = await repairMemoryQualityPageHandler(context({
    pageMemory: current,
    relationships: [relationship],
    documents: { memory_other: other },
    patches,
  }) as never, { dryRun: false });

  assert.equal(result.duplicateSupersededCount, 0);
  assert.deepEqual(patches, []);
});
