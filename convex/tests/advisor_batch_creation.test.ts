import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";
import { createAdvisorBatchForTurn } from "../advisors/batch_creation";

type TestRow = Record<string, unknown>;
type IndexQuery = { eq: (field: string, value: unknown) => IndexQuery };
type BatchArgs = Parameters<typeof createAdvisorBatchForTurn>[1];

test("one turn creates one shared batch, persists only keep=true selections, and is idempotent", async () => {
  const tables: Record<string, TestRow[]> = {
    advisorBatches: [],
    advisorRuns: [],
    chatAdvisors: [{
      _id: "assignment_old",
      userId: "user_1",
      chatId: "chat_1",
      personaId: "persona_1",
      instanceName: "persona_persona_1",
      sortOrder: 0,
      allowWebSearch: false,
      createdAt: 1,
      updatedAt: 1,
    }],
    purchaseEntitlements: [{ userId: "user_1", status: "active" }],
    autonomousSessions: [],
    userPreferences: [{ userId: "user_1", defaultModelId: "text_model" }],
    cachedModels: [{ modelId: "text_model", architecture: { modality: "text->text" } }],
    oauthConnections: [],
  };
  const personas: Record<string, TestRow> = {
    persona_1: {
      _id: "persona_1",
      userId: "user_1",
      displayName: "One",
      systemPrompt: "First perspective",
      modelId: "text_model",
    },
    persona_2: {
      _id: "persona_2",
      userId: "user_1",
      displayName: "Two",
      systemPrompt: "Second perspective",
      modelId: "text_model",
    },
  };
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const deleted: string[] = [];
  const counters: Record<string, number> = {};
  const ctx = {
    db: {
      get: async (id: string) => personas[id] ?? null,
      query: (table: string) => ({
        withIndex: (_index: string, apply?: (query: IndexQuery) => void) => {
          const filters: Array<[string, unknown]> = [];
          const query: IndexQuery = {
            eq: (field: string, value: unknown) => {
              filters.push([field, value]);
              return query;
            },
          };
          apply?.(query);
          const filtered = () => (tables[table] ?? []).filter((row) =>
            filters.every(([field, value]) => row[field] === value)
          );
          return {
            first: async () => filtered()[0] ?? null,
            collect: async () => filtered(),
            order: () => ({ first: async () => filtered()[0] ?? null }),
          };
        },
      }),
      insert: async (table: string, value: Record<string, unknown>) => {
        counters[table] = (counters[table] ?? 0) + 1;
        const id = table === "advisorBatches"
          ? "batch_1"
          : `${table}_${counters[table]}`;
        (tables[table] ??= []).push({ _id: id, ...value });
        return id;
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
        for (const rows of Object.values(tables)) {
          const row = rows.find((candidate) => candidate._id === id);
          if (row) Object.assign(row, patch);
        }
      },
      delete: async (id: string) => {
        deleted.push(id);
        for (const rows of Object.values(tables)) {
          const index = rows.findIndex((candidate) => candidate._id === id);
          if (index >= 0) rows.splice(index, 1);
        }
      },
    },
    storage: { getUrl: async () => null },
    scheduler: {
      runAfter: async () => `scheduled_${Math.random()}`,
    },
  } as unknown as Parameters<typeof createAdvisorBatchForTurn>[0];

  const args = {
    userId: "user_1",
    chat: { _id: "chat_1", userId: "user_1", source: "user" },
    userMessageId: "user_message_1",
    assistantMessageIds: ["assistant_1", "assistant_2"],
    participants: [{ modelId: "text_model" }, { modelId: "text_model" }],
    selections: [
      { personaId: "persona_1", keepAvailable: false, allowWebSearch: true },
      { personaId: "persona_2", keepAvailable: true, allowWebSearch: false },
    ],
    brief: "Review the tradeoffs",
    generationSnapshot: {
      kind: "generation",
      args: { chatId: "chat_1", participants: [] },
    },
  } as unknown as BatchArgs;

  const firstBatch = await createAdvisorBatchForTurn(ctx, args);
  const secondBatch = await createAdvisorBatchForTurn(ctx, args);
  assert.equal(firstBatch, "batch_1");
  assert.equal(secondBatch, "batch_1");
  assert.deepEqual(deleted, []);
  assert.equal(tables.chatAdvisors.length, 2);
  assert.deepEqual(tables.chatAdvisors.map((row) => row.personaId), ["persona_1", "persona_2"]);
  assert.equal(tables.advisorBatches.length, 1);
  assert.equal(tables.advisorBatches[0].expectedRunCount, 2);
  assert.equal(tables.advisorRuns.length, 2);
  assert.deepEqual(
    patches.filter((entry) => entry.id.startsWith("assistant_")),
    [
      { id: "assistant_1", patch: { advisorBatchId: "batch_1" } },
      { id: "assistant_2", patch: { advisorBatchId: "batch_1" } },
    ],
  );
});

test("Advisor batch rejects duplicate or more-than-three selections before charging", async () => {
  const ctx = {
    db: {
      query: () => ({ withIndex: () => ({ first: async () => null }) }),
    },
  } as unknown as Parameters<typeof createAdvisorBatchForTurn>[0];
  for (const personaIds of [
    ["persona_1", "persona_1"],
    ["persona_1", "persona_2", "persona_3", "persona_4"],
  ]) {
    await assert.rejects(
      createAdvisorBatchForTurn(ctx, {
        userId: "user_1",
        chat: { _id: "chat_1" },
        userMessageId: "user_message_1",
        assistantMessageIds: ["assistant_1"],
        participants: [{ modelId: "text_model" }],
        selections: personaIds.map((personaId) => ({
          personaId,
          keepAvailable: false,
          allowWebSearch: false,
        })),
        generationSnapshot: { kind: "generation", args: {} },
      } as unknown as BatchArgs),
      (error: unknown) => error instanceof ConvexError && error.data?.code === "ADVISOR_LIMIT",
    );
  }
});

test("an explicit empty turn snapshot suppresses kept Advisors without removing them", async () => {
  const assignments = [{
    _id: "assignment_1",
    userId: "user_1",
    chatId: "chat_1",
    personaId: "persona_1",
    instanceName: "persona_persona_1",
    sortOrder: 0,
    allowWebSearch: false,
    createdAt: 1,
    updatedAt: 1,
  }];
  let inserted = false;
  let scheduled = false;
  const ctx = {
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          first: async () => null,
          collect: async () => table === "chatAdvisors" ? assignments : [],
        }),
      }),
      insert: async () => {
        inserted = true;
        return "unexpected";
      },
    },
    scheduler: {
      runAfter: async () => {
        scheduled = true;
        return "unexpected";
      },
    },
  } as unknown as Parameters<typeof createAdvisorBatchForTurn>[0];

  const batchId = await createAdvisorBatchForTurn(ctx, {
    userId: "user_1",
    chat: { _id: "chat_1", userId: "user_1", source: "user" },
    userMessageId: "user_message_1",
    assistantMessageIds: ["assistant_1"],
    participants: [{ modelId: "text_model" }],
    selections: [],
    generationSnapshot: { kind: "generation", args: {} },
  } as unknown as BatchArgs);

  assert.equal(batchId, null);
  assert.equal(inserted, false);
  assert.equal(scheduled, false);
  assert.equal(assignments.length, 1);
});

test("omitted turn selections inherit kept Advisors", async () => {
  const tables: Record<string, TestRow[]> = {
    advisorBatches: [],
    chatAdvisors: [{
      _id: "assignment_1",
      userId: "user_1",
      chatId: "chat_1",
      personaId: "persona_1",
      instanceName: "persona_persona_1",
      sortOrder: 0,
      allowWebSearch: false,
      createdAt: 1,
      updatedAt: 1,
    }],
    purchaseEntitlements: [{ userId: "user_1", status: "active" }],
    autonomousSessions: [],
    userPreferences: [{ userId: "user_1", defaultModelId: "text_model" }],
    cachedModels: [{ modelId: "text_model", architecture: { modality: "text->text" } }],
    oauthConnections: [],
  };
  const insertedTables: string[] = [];
  const ctx = {
    db: {
      get: async (id: string) => id === "persona_1"
        ? {
            _id: "persona_1",
            userId: "user_1",
            displayName: "Reviewer",
            systemPrompt: "Review carefully",
            modelId: "text_model",
          }
        : null,
      query: (table: string) => ({
        withIndex: () => {
          const rows = tables[table] ?? [];
          return {
            first: async () => rows[0] ?? null,
            collect: async () => rows,
            order: () => ({ first: async () => rows[0] ?? null }),
          };
        },
      }),
      insert: async (table: string) => {
        insertedTables.push(table);
        return table === "advisorBatches" ? "batch_1" : "run_1";
      },
      patch: async () => undefined,
    },
    storage: { getUrl: async () => null },
    scheduler: { runAfter: async () => "scheduled_1" },
  } as unknown as Parameters<typeof createAdvisorBatchForTurn>[0];

  const batchId = await createAdvisorBatchForTurn(ctx, {
    userId: "user_1",
    chat: { _id: "chat_1", userId: "user_1", source: "user" },
    userMessageId: "user_message_1",
    assistantMessageIds: ["assistant_1"],
    participants: [{ modelId: "text_model" }],
    generationSnapshot: { kind: "generation", args: {} },
  } as unknown as BatchArgs);

  assert.equal(batchId, "batch_1");
  assert.deepEqual(insertedTables, ["advisorBatches", "advisorRuns"]);
});
