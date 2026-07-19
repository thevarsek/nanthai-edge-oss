import assert from "node:assert/strict";
import test from "node:test";
import { createAdvisorBatchForTurn } from "../advisors/batch_creation";
import { durableWorkflow } from "../execution/components";

type TestRow = Record<string, unknown>;
type IndexQuery = { eq: (field: string, value: unknown) => IndexQuery };
type BatchArgs = Parameters<typeof createAdvisorBatchForTurn>[1];

function invalidAssignmentFixture() {
  const tables: Record<string, TestRow[]> = {
    chats: [{ _id: "chat_1", userId: "user_1", source: "user" }],
    advisorBatches: [],
    advisorRuns: [],
    chatAdvisors: [],
    purchaseEntitlements: [{ userId: "user_1", status: "active" }],
    autonomousSessions: [],
    userPreferences: [{ userId: "user_1", defaultModelId: "text_model" }],
    cachedModels: [
      { modelId: "text_model", architecture: { modality: "text->text" } },
      { modelId: "image_model", architecture: { modality: "text->image" } },
    ],
    oauthConnections: [],
  };
  const personas: Record<string, TestRow> = {
    persona_text: {
      _id: "persona_text",
      userId: "user_1",
      displayName: "Reviewer",
      systemPrompt: "Review carefully.",
      modelId: "text_model",
    },
    persona_image: {
      _id: "persona_image",
      userId: "user_1",
      displayName: "Illustrator",
      systemPrompt: "Create images.",
      modelId: "image_model",
    },
  };
  const patches: Array<{ id: string; patch: TestRow }> = [];
  const scheduled: string[] = [];
  let nextId = 0;
  const ctx = {
    db: {
      get: async (id: string) => personas[id] ?? Object.values(tables)
        .flat()
        .find((row) => row._id === id) ?? null,
      query: (table: string) => ({
        withIndex: (_index: string, apply?: (query: IndexQuery) => void) => {
          const filters: Array<[string, unknown]> = [];
          const query: IndexQuery = {
            eq: (field, value) => {
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
            unique: async () => filtered()[0] ?? null,
            collect: async () => filtered(),
            order: () => ({ first: async () => filtered()[0] ?? null }),
          };
        },
      }),
      insert: async (table: string, value: TestRow) => {
        nextId += 1;
        const id = table === "advisorBatches" ? `batch_${nextId}` : `${table}_${nextId}`;
        (tables[table] ??= []).push({ _id: id, ...value });
        return id;
      },
      patch: async (id: string, patch: TestRow) => {
        patches.push({ id, patch });
        const row = Object.values(tables).flat().find((candidate) => candidate._id === id);
        if (row) Object.assign(row, patch);
      },
    },
    storage: { getUrl: async () => null },
    scheduler: {
      runAfter: async () => {
        const id = `scheduled_${scheduled.length + 1}`;
        scheduled.push(id);
        return id;
      },
    },
  } as unknown as Parameters<typeof createAdvisorBatchForTurn>[0];
  return { ctx, tables, patches, scheduled };
}

function argsFor(selections: BatchArgs["selections"], userMessageId: string): BatchArgs {
  return {
    userId: "user_1",
    chat: { _id: "chat_1", userId: "user_1", source: "user" },
    userMessageId,
    assistantMessageIds: [`assistant_${userMessageId}`],
    participants: [{ modelId: "text_model" }],
    selections,
    generationSnapshot: { kind: "generation", args: {} },
  } as unknown as BatchArgs;
}

test("newly selected unavailable Personas are neither kept nor run while valid Advisors proceed", async (t) => {
  t.mock.method(durableWorkflow, "start", async () => "workflow_advisor_valid" as never);
  const fixture = invalidAssignmentFixture();
  const batchId = await createAdvisorBatchForTurn(fixture.ctx, argsFor([
    { personaId: "persona_image", keepAvailable: true, allowWebSearch: false },
    { personaId: "persona_text", keepAvailable: false, allowWebSearch: false },
  ] as BatchArgs["selections"], "user_1"));

  assert.ok(batchId);
  assert.deepEqual(fixture.tables.chatAdvisors, []);
  assert.deepEqual(fixture.tables.advisorRuns.map((row) => row.personaId), ["persona_text"]);
  assert.equal(fixture.tables.advisorBatches[0]?.expectedRunCount, 1);
});

test("an all-invalid Advisor snapshot never blocks or defers the main response", async () => {
  const fixture = invalidAssignmentFixture();
  const batchId = await createAdvisorBatchForTurn(fixture.ctx, argsFor([
    { personaId: "persona_image", keepAvailable: true, allowWebSearch: false },
  ] as BatchArgs["selections"], "user_2"));

  assert.equal(batchId, null);
  assert.deepEqual(fixture.tables.chatAdvisors, []);
  assert.equal(fixture.tables.advisorBatches.length, 0);
  assert.equal(fixture.tables.advisorRuns.length, 0);
  assert.equal(fixture.patches.length, 0);
  assert.equal(fixture.scheduled.length, 0);
});
