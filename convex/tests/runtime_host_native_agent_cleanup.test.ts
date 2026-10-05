import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { deleteUserTableBatch } from "../account/mutations";
import { deleteRuntimeNativeAgentsForChatBatch } from
  "../runtime_host/native_agent_cleanup";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";

test("chat cleanup drains native children before deleting their projection group", async () => {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    runtimeNativeAgentGroups: [{
      _id: "group-1", userId: "user-1", chatId: "chat-1", updatedAt: 1,
    }],
    runtimeNativeAgents: Array.from({ length: 6 }, (_, ordinal) => ({
      _id: `agent-${ordinal}`, groupId: "group-1", userId: "user-1",
      chatId: "chat-1", ordinal,
    })),
  };
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx;
  assert.equal(await deleteRuntimeNativeAgentsForChatBatch(
    ctx,
    "chat-1" as Id<"chats">,
    5,
  ), true);
  assert.equal(rows.runtimeNativeAgentGroups.length, 1);
  assert.equal(rows.runtimeNativeAgents.length, 1);
  assert.equal(await deleteRuntimeNativeAgentsForChatBatch(
    ctx,
    "chat-1" as Id<"chats">,
    5,
  ), false);
  assert.equal(rows.runtimeNativeAgentGroups.length, 0);
  assert.equal(rows.runtimeNativeAgents.length, 0);
});

test("account purge removes only the owner's native agent rows and groups", async () => {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    runtimeNativeAgents: [
      { _id: "agent-1", userId: "user-1", updatedAt: 1 },
      { _id: "agent-2", userId: "user-2", updatedAt: 1 },
    ],
    runtimeNativeAgentGroups: [
      { _id: "group-1", userId: "user-1", updatedAt: 1 },
      { _id: "group-2", userId: "user-2", updatedAt: 1 },
    ],
  };
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx;
  type PurgeHandler = (
    context: MutationCtx,
    args: { userId: string; tableName: string; cursor?: string },
  ) => Promise<{ deleted: number; cursor?: string; done?: boolean }>;
  const handler = (deleteUserTableBatch as unknown as { _handler: PurgeHandler })._handler;
  assert.deepEqual(await handler(ctx, {
    userId: "user-1",
    tableName: "runtimeNativeAgents",
  }), { deleted: 1 });
  assert.deepEqual(await handler(ctx, {
    userId: "user-1",
    tableName: "runtimeNativeAgentGroups",
  }), { deleted: 1 });
  assert.deepEqual(rows.runtimeNativeAgents.map((row) => row._id), ["agent-2"]);
  assert.deepEqual(rows.runtimeNativeAgentGroups.map((row) => row._id), ["group-2"]);
});
