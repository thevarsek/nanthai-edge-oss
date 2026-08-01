import assert from "node:assert/strict";
import test from "node:test";
import { mcpContextCardsByMessage } from "../mcp/message_cards";

test("mcpContextCardsByMessage deduplicates reads and exposes public invocation IDs", async () => {
  const reads: string[] = [];
  const rows: Record<string, Record<string, unknown>> = {
    invocation_1: {
      _id: "invocation_1",
      publicId: "public_invocation",
      userId: "user_1",
      kind: "prompt",
      catalogItemId: "item_1",
      connectionId: "connection_1",
    },
    item_1: { _id: "item_1", title: "Prompt title", remoteName: "prompt" },
    connection_1: { _id: "connection_1", userId: "user_1", friendlyName: "Server" },
  };
  const ctx = {
    db: {
      get: async (id: string) => {
        reads.push(id);
        return rows[id] ?? null;
      },
    },
  };
  const messages = [
    { _id: "message_1", userId: "user_1", mcpInvocationIds: ["invocation_1"] },
    { _id: "message_2", userId: "user_1", mcpInvocationIds: ["invocation_1"] },
  ];

  const cards = await mcpContextCardsByMessage(ctx as never, messages as never);

  assert.deepEqual(reads, ["invocation_1", "item_1", "connection_1"]);
  assert.equal(cards.get("message_1")?.[0]?.invocationId, "public_invocation");
  assert.equal(cards.get("message_2")?.[0]?.invocationId, "public_invocation");
});

test("mcpContextCardsByMessage retains snapshotted labels after disconnect", async () => {
  const rows: Record<string, Record<string, unknown>> = {
    invocation_1: {
      _id: "invocation_1",
      publicId: "public_invocation",
      userId: "user_1",
      kind: "resource",
      itemName: "Quarterly report",
      connectionId: "deleted_connection",
    },
  };
  const cards = await mcpContextCardsByMessage({
    db: { get: async (id: string) => rows[id] ?? null },
  } as never, [{
    _id: "message_1",
    userId: "user_1",
    mcpInvocationIds: ["invocation_1"],
  }] as never);

  assert.deepEqual(cards.get("message_1"), [{
    invocationId: "public_invocation",
    label: "Quarterly report",
    serverName: "Disconnected Remote MCP server",
    kind: "resource",
  }]);
});
