import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import {
  deleteModelSettings,
  ensureUserPreferences,
  upsertModelSettings,
  upsertPreferences,
} from "../preferences/mutations";
import {
  getModelSettings,
  getPreferences,
  listModelSettings,
} from "../preferences/queries";

function buildAuth(userId: string | null = "user_1") {
  return {
    getUserIdentity: async () =>
      userId ? { subject: userId, email: "user@example.com" } : null,
  };
}

test("ensureUserPreferences returns existing row id without inserting", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];

  const result = await (ensureUserPreferences as any)._handler({
    auth: buildAuth(),
    db: {
      query: () => ({
        withIndex: () => ({
          first: async () => ({ _id: "prefs_existing" }),
        }),
      }),
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return "prefs_new";
      },
    },
  }, {});

  assert.equal(result, "prefs_existing");
  assert.equal(inserts.length, 0);
});

test("upsertPreferences clears defaultPersonaId via explicit flag", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

  const result = await (upsertPreferences as any)._handler({
    auth: buildAuth(),
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          first: async () =>
            table === "userPreferences"
              ? { _id: "prefs_1", userId: "user_1", defaultPersonaId: "persona_1" }
              : null,
        }),
      }),
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
    },
  }, {
    clearDefaultPersona: true,
    defaultPersonaId: null,
  });

  assert.equal(result, "prefs_1");
  assert.deepEqual(patches[0], {
    id: "prefs_1",
    patch: {
      updatedAt: patches[0]?.patch.updatedAt,
      defaultPersonaId: undefined,
    },
  });
});

test("upsertPreferences rejects enabling default subagents for non-Pro users", async () => {
  await assert.rejects(
    (upsertPreferences as any)._handler({
      auth: buildAuth(),
      db: {
        query: (table: string) => ({
          withIndex: () => ({
            first: async () => {
              if (table === "purchaseEntitlements") return null;
              return null;
            },
          }),
        }),
      },
    }, {
      subagentsEnabledByDefault: true,
    }),
    (error: unknown) => {
      assert.ok(error instanceof ConvexError);
      return (error as ConvexError<any>).data?.code === "PRO_REQUIRED";
    },
  );
});

test("upsertModelSettings converts null updates into cleared fields", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

  const result = await (upsertModelSettings as any)._handler({
    auth: buildAuth(),
    db: {
      query: () => ({
        withIndex: () => ({
          first: async () => ({
            _id: "setting_1",
            userId: "user_1",
            openRouterId: "openai/gpt-5.2",
            maxTokens: 4096,
            reasoningEffort: "high",
          }),
        }),
      }),
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
    },
  }, {
    openRouterId: "openai/gpt-5.2",
    maxTokens: null,
    includeReasoning: null,
    reasoningEffort: null,
  });

  assert.equal(result, "setting_1");
  assert.deepEqual(patches[0], {
    id: "setting_1",
    patch: {
      updatedAt: patches[0]?.patch.updatedAt,
      maxTokens: undefined,
      includeReasoning: undefined,
      reasoningEffort: undefined,
    },
  });
});

test("deleteModelSettings is idempotent when no row exists", async () => {
  let deleted = false;

  await (deleteModelSettings as any)._handler({
    auth: buildAuth(),
    db: {
      query: () => ({
        withIndex: () => ({
          first: async () => null,
        }),
      }),
      delete: async () => {
        deleted = true;
      },
    },
  }, {
    openRouterId: "openai/gpt-5.2",
  });

  assert.equal(deleted, false);
});

test("getPreferences returns null for anonymous callers", async () => {
  const result = await (getPreferences as any)._handler({
    auth: buildAuth(null),
    db: {},
  }, {});

  assert.equal(result, null);
});

test("getModelSettings and listModelSettings are user-scoped", async () => {
  const rows = [
    { _id: "s1", userId: "user_1", openRouterId: "openai/gpt-5.2" },
    { _id: "s2", userId: "user_1", openRouterId: "anthropic/claude-sonnet-4.5" },
  ];

  const db = {
    query: (table: string) => ({
      withIndex: (_index: string, apply: (q: any) => unknown) => {
        let requestedModelId: string | undefined;
        apply({
          eq: (_field: string, value: string) => ({
            eq: (_field2: string, value2: string) => {
              requestedModelId = value2;
              return { userId: value, openRouterId: value2 };
            },
          }),
        });
        return {
          first: async () => {
            if (table !== "modelSettings") return null;
            return rows.find((row) => row.openRouterId === requestedModelId) ?? null;
          },
          collect: async () => rows,
        };
      },
    }),
  };

  const single = await (getModelSettings as any)._handler({
    auth: buildAuth(),
    db,
  }, {
    openRouterId: "anthropic/claude-sonnet-4.5",
  });
  const list = await (listModelSettings as any)._handler({
    auth: buildAuth(),
    db,
  }, {});

  assert.equal(single?._id, "s2");
  assert.deepEqual(list.map((row: any) => row._id), ["s1", "s2"]);
});
