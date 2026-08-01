import assert from "node:assert/strict";
import test from "node:test";
import { replaceCatalog } from "../mcp/catalog_mutations";
import { createInvocation } from "../mcp/invocation_mutations";
import { createConnection, storeCredential } from "../mcp/mutations";
import { createOAuthTransaction } from "../mcp/oauth_mutations";

function deletionFencedContext() {
  let writes = 0;
  return {
    get writes() {
      return writes;
    },
    ctx: {
      db: {
        query: (table: string) => {
          assert.equal(table, "accountDeletionTombstones");
          return {
            withIndex: () => ({
              unique: async () => ({ _id: "deletion_1", userId: "user_1" }),
            }),
          };
        },
        get: async () => {
          writes += 1;
          return null;
        },
        insert: async () => {
          writes += 1;
          return "unexpected";
        },
        patch: async () => {
          writes += 1;
        },
        replace: async () => {
          writes += 1;
        },
      },
    },
  };
}

test("MCP late-writer mutations reject account-deletion races transactionally", async () => {
  const guardedMutations = [
    {
      fn: createConnection,
      args: { userId: "user_1" },
      result: "reject",
    },
    {
      fn: storeCredential,
      args: { userId: "user_1" },
      result: false,
    },
    {
      fn: createOAuthTransaction,
      args: { userId: "user_1" },
      result: "reject",
    },
    {
      fn: replaceCatalog,
      args: { userId: "user_1" },
      result: "reject",
    },
    {
      fn: createInvocation,
      args: { userId: "user_1" },
      result: "reject",
    },
  ] as const;

  for (const guarded of guardedMutations) {
    const guard = deletionFencedContext();
    const handler = (guarded.fn as unknown as {
      _handler: (context: unknown, args: Record<string, unknown>) => Promise<unknown>;
    })._handler;
    if (guarded.result === "reject") {
      await assert.rejects(handler(guard.ctx, { ...guarded.args }), /USER_DATA_NOT_WRITABLE/);
    } else {
      assert.equal(await handler(guard.ctx, { ...guarded.args }), false);
    }
    assert.equal(guard.writes, 0);
  }
});
