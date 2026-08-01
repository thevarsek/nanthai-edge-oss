import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import { deleteDisconnectableInvocationPage } from "../mcp/connection_invocation_cleanup";

type Invocation = {
  _id: string;
  connectionId: string;
  state: string;
  messageId?: string;
  contentItems?: Array<{ storageId?: string }>;
};

function cleanupContext(rows: Invocation[]) {
  const deletedRows: string[] = [];
  const deletedStorage: string[] = [];
  return {
    deletedRows,
    deletedStorage,
    ctx: {
      db: {
        query: (table: string) => {
          assert.equal(table, "mcpInvocations");
          let selected: Invocation[] = [];
          let unlinkedOnly = false;
          const selection = {
            filter: () => {
              unlinkedOnly = true;
              return selection;
            },
            take: async (limit: number) => selected
              .filter((row) => !unlinkedOnly || row.messageId === undefined)
              .slice(0, limit),
          };
          return {
            withIndex: (
              index: string,
              apply: (query: {
                eq: (field: string, value: string) => unknown;
              }) => unknown,
            ) => {
              assert.equal(index, "by_connection_state");
              let connectionId = "";
              let state = "";
              const query = {
                eq: (field: string, value: string) => {
                  if (field === "connectionId") connectionId = value;
                  if (field === "state") state = value;
                  return query;
                },
              };
              apply(query);
              selected = rows.filter((row) =>
                row.connectionId === connectionId && row.state === state);
              return selection;
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
    },
  };
}

test("disconnect cleanup preserves completed invocations attached to messages", async () => {
  const cleanup = cleanupContext([
    {
      _id: "active",
      connectionId: "connection_1",
      state: "dispatching",
      contentItems: [{ storageId: "active_storage" }],
    },
    { _id: "failed", connectionId: "connection_1", state: "failed" },
    {
      _id: "completed_unlinked",
      connectionId: "connection_1",
      state: "completed",
      contentItems: [{ storageId: "unlinked_storage" }],
    },
    {
      _id: "completed_linked",
      connectionId: "connection_1",
      state: "completed",
      messageId: "message_1",
      contentItems: [{ storageId: "historical_storage" }],
    },
  ]);

  const hasMore = await deleteDisconnectableInvocationPage(
    cleanup.ctx as never,
    "connection_1" as Id<"mcpConnections">,
    50,
  );

  assert.equal(hasMore, false);
  assert.deepEqual(cleanup.deletedRows, ["active", "failed", "completed_unlinked"]);
  assert.deepEqual(cleanup.deletedStorage, ["active_storage", "unlinked_storage"]);
});

test("disconnect cleanup reports a full bounded page", async () => {
  const cleanup = cleanupContext([
    { _id: "failed_1", connectionId: "connection_1", state: "failed" },
    { _id: "failed_2", connectionId: "connection_1", state: "failed" },
    { _id: "failed_3", connectionId: "connection_1", state: "failed" },
  ]);

  assert.equal(await deleteDisconnectableInvocationPage(
    cleanup.ctx as never,
    "connection_1" as Id<"mcpConnections">,
    2,
  ), true);
  assert.deepEqual(cleanup.deletedRows, ["failed_1", "failed_2"]);
});
