import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import {
  approveAllHandler,
  createManualHandler,
  deleteAllHandler,
  listHandler,
  rejectAllHandler,
  removeHandler,
  updateHandler,
} from "../memory/operations_public_handlers";

function buildAuth(userId: string | null = "user_1") {
  return {
    getUserIdentity: async () => (userId ? { subject: userId } : null),
  };
}

test("listHandler requires Pro and filters inactive memories", async () => {
  const now = Date.now();
  const result = await listHandler({
    auth: buildAuth(),
    db: {
      query: () => ({
        withIndex: () => ({
          take: async () => [
            { _id: "active", userId: "user_1", content: "User prefers concise replies.", updatedAt: now },
            { _id: "expired", userId: "user_1", content: "Old", expiresAt: now - 1, updatedAt: now },
            { _id: "superseded", userId: "user_1", content: "Old2", isSuperseded: true, updatedAt: now },
          ],
          first: async () => ({ status: "active" }),
          order: () => ({
            take: async () => [
              { _id: "active", userId: "user_1", content: "User prefers concise replies.", updatedAt: now },
              { _id: "expired", userId: "user_1", content: "Old", expiresAt: now - 1, updatedAt: now },
            ],
          }),
        }),
      }),
    },
  } as any, {
    limit: 5,
  });

  assert.deepEqual(result.map((memory: any) => memory._id), ["active"]);
  assert.equal(result[0]?.category, "writingStyle");
});

test("listHandler rejects authenticated free users", async () => {
  await assert.rejects(
    listHandler({
      auth: buildAuth(),
      db: {
        query: (table: string) => ({
          withIndex: () => ({
            first: async () => (table === "purchaseEntitlements" ? null : null),
          }),
        }),
      },
    } as any, {}),
    (error: unknown) => {
      assert.ok(error instanceof ConvexError);
      return (error as ConvexError<any>).data?.code === "PRO_REQUIRED";
    },
  );
});

test("listHandler rejects unauthenticated callers", async () => {
  await assert.rejects(
    listHandler({
      auth: buildAuth(null),
      db: {},
    } as any, {}),
    /Authentication required/i,
  );
});

test("updateHandler normalizes fields and refreshes embeddings", async () => {
  const deleted: string[] = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const scheduled: Array<Record<string, unknown>> = [];

  await updateHandler({
    auth: buildAuth(),
    db: {
      get: async (id: string) =>
        id === "memory_1"
          ? {
              _id: "memory_1",
              userId: "user_1",
              content: "Old content",
              category: "work",
              retrievalMode: "contextual",
              scopeType: "selectedPersonas",
              personaIds: ["persona_old"],
              tags: [" old "],
            }
          : null,
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
      delete: async (id: string) => {
        deleted.push(id);
      },
      query: (table: string) => ({
        withIndex: () => ({
          first: async () => {
            if (table === "memoryEmbeddings") {
              return { _id: "embedding_1", memoryId: "memory_1" };
            }
            if (table === "purchaseEntitlements") {
              return { status: "active" };
            }
            return null;
          },
        }),
      }),
    },
    scheduler: {
      runAfter: async (_delay: number, _fn: unknown, payload: Record<string, unknown>) => {
        scheduled.push(payload);
      },
    },
  } as any, {
    memoryId: "memory_1" as any,
    content: " User prefers concise bullet points. ",
    scopeType: "allPersonas",
    personaIds: ["persona_new"],
    tags: [" alpha ", " ", "beta"],
  });

  assert.deepEqual(deleted, ["embedding_1"]);
  assert.equal(patches[0]?.id, "memory_1");
  assert.equal(patches[0]?.patch.content, "User prefers concise bullet points.");
  assert.equal(patches[0]?.patch.scopeType, "allPersonas");
  assert.deepEqual(patches[0]?.patch.personaIds, []);
  assert.deepEqual(patches[0]?.patch.tags, ["alpha", "beta"]);
  assert.deepEqual(scheduled, [{
    memoryId: "memory_1",
    content: "User prefers concise bullet points.",
  }]);
});

test("updateHandler rejects non-Pro writers", async () => {
  await assert.rejects(
    updateHandler({
      auth: buildAuth(),
      db: {
        get: async () => ({
          _id: "memory_1",
          userId: "user_1",
          content: "Old content",
        }),
        query: (table: string) => ({
          withIndex: () => ({
            first: async () => (table === "purchaseEntitlements" ? null : null),
          }),
        }),
      },
    } as any, {
      memoryId: "memory_1" as any,
      content: "New",
    }),
    (error: unknown) => {
      assert.ok(error instanceof ConvexError);
      return (error as ConvexError<any>).data?.code === "PRO_REQUIRED";
    },
  );
});

test("removeHandler deletes both embedding and memory", async () => {
  const deleted: string[] = [];

  await removeHandler({
    auth: buildAuth(),
    db: {
      get: async () => ({ _id: "memory_1", userId: "user_1" }),
      query: () => ({
        withIndex: () => ({
          first: async () => ({ _id: "embedding_1", memoryId: "memory_1" }),
        }),
      }),
      delete: async (id: string) => {
        deleted.push(id);
      },
    },
  } as any, {
    memoryId: "memory_1" as any,
  });

  assert.deepEqual(deleted, ["embedding_1", "memory_1"]);
});

test("createManualHandler inserts normalized memory and schedules embedding", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const scheduled: Array<Record<string, unknown>> = [];

  const result = await createManualHandler({
    auth: buildAuth(),
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          first: async () => (table === "purchaseEntitlements" ? { status: "active" } : null),
        }),
      }),
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return "memory_new";
      },
    },
    scheduler: {
      runAfter: async (_delay: number, _fn: unknown, payload: Record<string, unknown>) => {
        scheduled.push(payload);
      },
    },
  } as any, {
    content: "  User prefers concise answers. ",
    scopeType: "selectedPersonas",
    personaIds: ["persona_1", "", "persona_2"],
    tags: [" focus ", " "],
    isPinned: true,
  });

  assert.equal(result, "memory_new");
  assert.equal(inserts[0]?.table, "memories");
  assert.equal(inserts[0]?.value.category, "writingStyle");
  assert.equal(inserts[0]?.value.memoryType, "responsePreference");
  assert.deepEqual(inserts[0]?.value.personaIds, ["persona_1", "persona_2"]);
  assert.deepEqual(inserts[0]?.value.tags, ["focus"]);
  assert.equal(inserts[0]?.value.isPinned, true);
  assert.deepEqual(scheduled, [{
    memoryId: "memory_new",
    content: "User prefers concise answers.",
  }]);
});

test("deleteAllHandler schedules continuation when a full batch is processed", async () => {
  const deleted: string[] = [];
  const scheduled: Array<Record<string, unknown>> = [];
  const memories = Array.from({ length: 100 }, (_, index) => ({ _id: `memory_${index}` }));

  await deleteAllHandler({
    auth: buildAuth(),
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          take: async () => (table === "memories" ? memories : []),
          first: async () => (table === "purchaseEntitlements" ? { status: "active" } : null),
        }),
      }),
      delete: async (id: string) => {
        deleted.push(id);
      },
    },
    scheduler: {
      runAfter: async (_delay: number, _fn: unknown, payload: Record<string, unknown>) => {
        scheduled.push(payload);
      },
    },
  } as any);

  assert.equal(deleted.length, 100);
  assert.deepEqual(scheduled, [{ userId: "user_1" }]);
});

test("approveAllHandler and rejectAllHandler process one batch and self-schedule", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const deleted: string[] = [];
  const scheduled: Array<Record<string, unknown>> = [];
  const pending = Array.from({ length: 100 }, (_, index) => ({ _id: `memory_${index}` }));

  const queryFactory = (table: string) => ({
    withIndex: () => ({
      take: async () => (table === "memories" ? pending : []),
      first: async () => null,
    }),
  });

  const approveCount = await approveAllHandler({
    auth: buildAuth(),
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          take: async () => (table === "memories" ? pending : []),
          first: async () => (table === "purchaseEntitlements" ? { status: "active" } : null),
        }),
      }),
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
    },
    scheduler: {
      runAfter: async (_delay: number, _fn: unknown, payload: Record<string, unknown>) => {
        scheduled.push(payload);
      },
    },
  } as any);

  const rejectCount = await rejectAllHandler({
    auth: buildAuth(),
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          take: async () => (table === "memories" ? pending : []),
          first: async () => (table === "purchaseEntitlements" ? { status: "active" } : null),
        }),
      }),
      delete: async (id: string) => {
        deleted.push(id);
      },
    },
    scheduler: {
      runAfter: async (_delay: number, _fn: unknown, payload: Record<string, unknown>) => {
        scheduled.push(payload);
      },
    },
  } as any);

  assert.equal(approveCount, 100);
  assert.equal(rejectCount, 100);
  assert.equal(patches.length, 100);
  assert.equal(deleted.length, 100);
  assert.equal(scheduled.length, 2);
  assert.deepEqual(scheduled[0], { userId: "user_1" });
  assert.deepEqual(scheduled[1], { userId: "user_1" });
});
