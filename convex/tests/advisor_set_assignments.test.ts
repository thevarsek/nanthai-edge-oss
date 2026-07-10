import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";
import { setChatAdvisors } from "../advisors/mutations";

type TestRow = Record<string, unknown>;
type IndexQuery = { eq: (field: string, value: unknown) => IndexQuery };

const setChatAdvisorsHandler = (setChatAdvisors as unknown as {
  _handler: (
    ctx: unknown,
    args: { chatId: string; advisors: Array<{ personaId: string; allowWebSearch: boolean }> },
  ) => Promise<{ advisors: Array<{ personaId: string; isAvailable: boolean }> }>;
})._handler;

function assignmentFixture() {
  const tables: Record<string, TestRow[]> = {
    chats: [{ _id: "chat_1", userId: "user_1", source: "user" }],
    chatAdvisors: [{
      _id: "assignment_existing",
      userId: "user_1",
      chatId: "chat_1",
      personaId: "persona_existing_image",
      instanceName: "persona_existing_image",
      sortOrder: 0,
      allowWebSearch: false,
      createdAt: 1,
      updatedAt: 1,
    }],
    chatParticipants: [{ chatId: "chat_1", modelId: "text_model" }],
    purchaseEntitlements: [{ userId: "user_1", status: "active" }],
    userPreferences: [{ userId: "user_1", defaultModelId: "text_model" }],
    autonomousSessions: [],
    oauthConnections: [],
    cachedModels: [
      { modelId: "text_model", architecture: { modality: "text->text" } },
      { modelId: "image_model", architecture: { modality: "text->image" } },
    ],
  };
  const personas: Record<string, TestRow> = {
    persona_existing_image: {
      _id: "persona_existing_image",
      userId: "user_1",
      displayName: "Existing illustrator",
      systemPrompt: "Illustrate.",
      modelId: "image_model",
    },
    persona_new_text: {
      _id: "persona_new_text",
      userId: "user_1",
      displayName: "New reviewer",
      systemPrompt: "Review.",
      modelId: "text_model",
    },
    persona_new_image: {
      _id: "persona_new_image",
      userId: "user_1",
      displayName: "New illustrator",
      systemPrompt: "Illustrate.",
      modelId: "image_model",
    },
  };
  const deleted: string[] = [];
  let inserted = 0;
  const ctx = {
    auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
    db: {
      get: async (id: string) => {
        const tableRow = Object.values(tables).flat().find((row) => row._id === id);
        return tableRow ?? personas[id] ?? null;
      },
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
            collect: async () => filtered(),
            order: () => ({ first: async () => filtered()[0] ?? null }),
          };
        },
      }),
      patch: async (id: string, patch: TestRow) => {
        const row = Object.values(tables).flat().find((candidate) => candidate._id === id);
        if (row) Object.assign(row, patch);
      },
      insert: async (table: string, value: TestRow) => {
        inserted += 1;
        const id = `assignment_new_${inserted}`;
        (tables[table] ??= []).push({ _id: id, ...value });
        return id;
      },
      delete: async (id: string) => {
        deleted.push(id);
        for (const rows of Object.values(tables)) {
          const index = rows.findIndex((row) => row._id === id);
          if (index >= 0) rows.splice(index, 1);
        }
      },
    },
    storage: { getUrl: async () => null },
    scheduler: { runAfter: async () => "analytics_1" },
  };
  return { ctx, tables, deleted };
}

test("full Advisor replacement preserves an existing unavailable assignment", async () => {
  const fixture = assignmentFixture();
  const result = await setChatAdvisorsHandler(fixture.ctx, {
    chatId: "chat_1",
    advisors: [
      { personaId: "persona_existing_image", allowWebSearch: true },
      { personaId: "persona_new_text", allowWebSearch: false },
    ],
  });

  assert.deepEqual(result.advisors.map((advisor) => advisor.personaId), [
    "persona_existing_image",
    "persona_new_text",
  ]);
  assert.equal(result.advisors[0]?.isAvailable, false);
  assert.deepEqual(fixture.deleted, []);
  assert.deepEqual(fixture.tables.chatAdvisors.map((row) => row.personaId), [
    "persona_existing_image",
    "persona_new_text",
  ]);
});

test("full Advisor replacement rejects a newly added unavailable Persona", async () => {
  const fixture = assignmentFixture();
  await assert.rejects(
    setChatAdvisorsHandler(fixture.ctx, {
      chatId: "chat_1",
      advisors: [
        { personaId: "persona_existing_image", allowWebSearch: false },
        { personaId: "persona_new_image", allowWebSearch: false },
      ],
    }),
    (error: unknown) => error instanceof ConvexError &&
      error.data?.code === "ADVISOR_PERSONA_UNAVAILABLE",
  );
  assert.deepEqual(fixture.tables.chatAdvisors.map((row) => row.personaId), [
    "persona_existing_image",
  ]);
});
