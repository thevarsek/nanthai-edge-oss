import assert from "node:assert/strict";
import test from "node:test";

import { getGenerationContextHandler } from "../chat/queries_generation_context";

// ---------------------------------------------------------------------------
// Minimal QueryCtx mock for getGenerationContext tests
// ---------------------------------------------------------------------------

function createQueryCtx(overrides: {
  docs?: Record<string, Record<string, unknown>>;
  tables?: Record<string, Array<Record<string, unknown>>>;
} = {}) {
  const docs = overrides.docs ?? {};
  const tables = overrides.tables ?? {};

  return {
    db: {
      get: async (id: string) => docs[id] ?? null,
      query: (table: string) => {
        const rows = tables[table] ?? [];
        return {
          withIndex: (_indexName: string, filterFn: (q: any) => any) => {
            // Build a simple equality filter chain
            const filters: Record<string, unknown> = {};
            const q = new Proxy({} as any, {
              get: (_target, prop) => {
                if (prop === "eq") {
                  return (field: string, value: unknown) => {
                    filters[field] = value;
                    return q;
                  };
                }
                return q;
              },
            });
            filterFn(q);
            const filtered = rows.filter((row) =>
              Object.entries(filters).every(([k, v]) => row[k] === v),
            );
            return {
              first: async () => filtered[0] ?? null,
              collect: async () => filtered,
            };
          },
        };
      },
    },
    storage: {
      getUrl: async () => null,
    },
  } as any;
}

test("getGenerationContextHandler returns isPro, message, chat, defaults, connections, and personas", async () => {
  const ctx = createQueryCtx({
    docs: {
      msg_1: { _id: "msg_1", attachments: [{ storageId: "f1", mimeType: "application/pdf" }], content: "hello" },
      chat_1: { _id: "chat_1", integrationOverrides: [], skillOverrides: [] },
      persona_1: { _id: "persona_1", userId: "user_1", systemPrompt: "Be helpful" },
    },
    tables: {
      purchaseEntitlements: [
        { userId: "user_1", status: "active" },
      ],
      userPreferences: [
        {
          userId: "user_1",
          skillDefaults: [{ skillId: "s1", state: "always" }],
          integrationDefaults: [{ integrationId: "drive", enabled: true }],
        },
      ],
      oauthConnections: [
        { userId: "user_1", provider: "google", status: "active", scopes: ["https://www.googleapis.com/auth/drive"] },
        { userId: "user_1", provider: "microsoft", status: "active", scopes: [] },
        { userId: "user_1", provider: "notion", status: "expired", scopes: [] },
      ],
    },
  });

  const result = await getGenerationContextHandler(ctx, {
    userId: "user_1",
    chatId: "chat_1" as any,
    messageId: "msg_1" as any,
    personaIds: ["persona_1"],
  });

  assert.equal(result.isPro, true);
  assert.equal(result.currentUserMessage?._id, "msg_1");
  assert.equal(result.chatDoc?._id, "chat_1");
  assert.deepEqual(result.skillIntegrationDefaults?.skillDefaults, [{ skillId: "s1", state: "always" }]);
  assert.deepEqual(result.skillIntegrationDefaults?.integrationDefaults, [{ integrationId: "drive", enabled: true }]);
  // Google active with drive scope → "drive". Microsoft active → outlook, onedrive, ms_calendar. Notion expired → excluded.
  assert.ok(result.connectedIntegrationIds.includes("drive"));
  assert.ok(!result.connectedIntegrationIds.includes("gmail")); // no gmail scope
  assert.ok(result.connectedIntegrationIds.includes("outlook"));
  assert.ok(result.connectedIntegrationIds.includes("ms_calendar"));
  assert.ok(!result.connectedIntegrationIds.includes("notion")); // expired
  // Persona resolved
  assert.equal(result.personasById["persona_1"]?._id, "persona_1");
});

test("getGenerationContextHandler returns isPro=false when no entitlement", async () => {
  const ctx = createQueryCtx({
    docs: {
      msg_1: { _id: "msg_1", attachments: [] },
      chat_1: { _id: "chat_1" },
    },
    tables: {
      purchaseEntitlements: [],
      userPreferences: [],
      oauthConnections: [],
    },
  });

  const result = await getGenerationContextHandler(ctx, {
    userId: "user_1",
    chatId: "chat_1" as any,
    messageId: "msg_1" as any,
    personaIds: [],
  });

  assert.equal(result.isPro, false);
  assert.deepEqual(result.connectedIntegrationIds, []);
  assert.deepEqual(result.personasById, {});
  assert.equal(result.skillIntegrationDefaults?.skillDefaults, undefined);
});

test("getGenerationContextHandler handles all 6 providers correctly", async () => {
  const ctx = createQueryCtx({
    docs: {
      msg_1: { _id: "msg_1", attachments: [] },
      chat_1: { _id: "chat_1" },
    },
    tables: {
      purchaseEntitlements: [],
      userPreferences: [],
      oauthConnections: [
        { userId: "u1", provider: "google", status: "active", scopes: [
          "https://www.googleapis.com/auth/gmail.modify",
          "https://www.googleapis.com/auth/drive",
          "https://www.googleapis.com/auth/calendar",
        ] },
        { userId: "u1", provider: "microsoft", status: "active", scopes: [] },
        { userId: "u1", provider: "apple_calendar", status: "active", scopes: [] },
        { userId: "u1", provider: "notion", status: "active", scopes: [] },
        { userId: "u1", provider: "cloze", status: "active", scopes: [] },
        { userId: "u1", provider: "slack", status: "active", scopes: [] },
      ],
    },
  });

  const result = await getGenerationContextHandler(ctx, {
    userId: "u1",
    chatId: "chat_1" as any,
    messageId: "msg_1" as any,
    personaIds: [],
  });

  const ids = result.connectedIntegrationIds;
  assert.ok(ids.includes("gmail"));
  assert.ok(ids.includes("drive"));
  assert.ok(ids.includes("calendar"));
  assert.ok(ids.includes("outlook"));
  assert.ok(ids.includes("onedrive"));
  assert.ok(ids.includes("ms_calendar"));
  assert.ok(ids.includes("apple_calendar"));
  assert.ok(ids.includes("notion"));
  assert.ok(ids.includes("cloze"));
  assert.ok(ids.includes("slack"));
  assert.equal(ids.length, 10);
});
