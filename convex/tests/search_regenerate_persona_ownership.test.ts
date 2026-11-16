import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import { regeneratePaperHandler } from "../search/mutations_regenerate";

test("regeneratePaperHandler rejects another user's Persona before writing", async () => {
  const writes: string[] = [];
  const ctx = {
    auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
    db: {
      get: async (id: string) => id === "persona_foreign" ? { _id: id, userId: "other_user" } : null,
      insert: async (table: string) => { writes.push(table); return `${table}_1`; },
      patch: async (id: string) => { writes.push(id); },
      query: () => ({ withIndex: () => ({ first: async () => ({ userId: "user_1", status: "active" }) }) }),
    },
  } as any;
  await assert.rejects(
    regeneratePaperHandler(ctx, { sessionId: "session_source" as any, modelId: "openai/gpt-5.2", personaId: "persona_foreign" as any }),
    (error: unknown) => error instanceof ConvexError && (error.data as { code?: string })?.code === "NOT_FOUND",
  );
  assert.deepEqual(writes, []);
});
