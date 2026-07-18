import assert from "node:assert/strict";
import test from "node:test";

import { commitImportedMemoriesHandler } from "../memory/operations_import_commit_handlers";

test("import commit enforces deterministic retrieval and normalized scores", async () => {
  const inserts: Array<Record<string, unknown>> = [];
  const scheduled: Array<Record<string, unknown>> = [];
  const created = await commitImportedMemoriesHandler({
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          first: async () => table === "purchaseEntitlements"
            ? { status: "active" }
            : null,
          collect: async () => [],
        }),
      }),
      insert: async (_table: string, value: Record<string, unknown>) => {
        inserts.push(value);
        return "memory_1";
      },
      delete: async () => undefined,
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
      },
    },
  } as never, {
    memories: [{
      content: "User leads an AI product team.",
      category: "work",
      retrievalMode: "alwaysOn",
      scopeType: "allPersonas",
      importanceScore: 8,
      confidenceScore: 9,
    }],
  });

  assert.equal(created, 1);
  assert.equal(inserts[0]?.retrievalMode, "contextual");
  assert.equal(inserts[0]?.importanceScore, 0.8);
  assert.equal(inserts[0]?.confidenceScore, 0.9);
  assert.deepEqual(scheduled, [{
    memoryId: "memory_1",
    content: "User leads an AI product team.",
  }]);
});
