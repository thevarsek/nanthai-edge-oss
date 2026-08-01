import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import { deleteChatMcpInvocationsBatch } from "../mcp/chat_cleanup";

test("deleteChatMcpInvocationsBatch deletes invocation content and rows", async () => {
  const deletedRows: string[] = [];
  const deletedStorage: string[] = [];
  const ctx = {
    db: {
      query: (table: string) => {
        assert.equal(table, "mcpInvocations");
        return {
          withIndex: (index: string) => {
            assert.equal(index, "by_chat");
            return {
              take: async () => [{
                _id: "invocation_1",
                contentItems: [
                  { kind: "text", text: "safe" },
                  { kind: "image", storageId: "storage_1" },
                ],
              }],
            };
          },
        };
      },
      delete: async (id: string) => {
        deletedRows.push(id);
      },
    },
    storage: {
      delete: async (id: string) => {
        deletedStorage.push(id);
      },
    },
  };

  const hasMore = await deleteChatMcpInvocationsBatch(
    ctx as never,
    "chat_1" as Id<"chats">,
    5,
  );

  assert.equal(hasMore, false);
  assert.deepEqual(deletedStorage, ["storage_1"]);
  assert.deepEqual(deletedRows, ["invocation_1"]);
});

test("deleteChatMcpInvocationsBatch reports a full batch", async () => {
  const ctx = {
    db: {
      query: () => ({
        withIndex: () => ({
          take: async () => Array.from({ length: 2 }, (_, index) => ({
            _id: `invocation_${index}`,
          })),
        }),
      }),
      delete: async () => undefined,
    },
    storage: { delete: async () => undefined },
  };

  assert.equal(await deleteChatMcpInvocationsBatch(
    ctx as never,
    "chat_1" as Id<"chats">,
    2,
  ), true);
});
