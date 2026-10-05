import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { ingestRuntimeEventHandler } from "../runtime_host/chat_event_ingestion";
import { listMyPendingPermissionsHandler } from "../runtime_host/permissions";
import {
  createPermissionFixture,
  permissionHost,
  permissionRequestedEvent,
} from "./runtime_host_permission_fixture";

test("permission requests attribute a matching Codex native child without changing control", async () => {
  const state = await createPermissionFixture();
  state.rows.runtimeNativeAgentGroups.push({
    _id: "native-group-1", userId: "user_1", chatId: "chat-1",
    messageId: "message-1", generationJobId: "job-1", runId: "run-1",
    attemptId: "attempt-1", fence: 7, adapterId: "codex",
    rootNativeSessionId: "native-1", rootNativeThreadId: "root-thread-1",
    status: "active", nextAgentOrdinal: 1,
    startedAt: state.now, updatedAt: state.now,
  });
  state.rows.runtimeNativeAgents.push({
    _id: "native-agent-1", groupId: "native-group-1", userId: "user_1",
    chatId: "chat-1", messageId: "message-1", nativeThreadId: "child-thread-1",
    parentNativeThreadId: "root-thread-1", ordinal: 0, depth: 1,
    nickname: "Reviewer", role: "Code review", status: "running",
    startedAt: state.now, updatedAt: state.now,
  });
  await ingestRuntimeEventHandler(state.ctx, {
    ...permissionHost,
    event: permissionRequestedEvent(0, state.now, {
      nativeAgentThreadId: "child-thread-1",
    }),
  });
  assert.equal(
    state.rows.runtimePermissionRequests[0].nativeAgentThreadId,
    "child-thread-1",
  );
  const pending = await listMyPendingPermissionsHandler(
    state.ctx as unknown as QueryCtx,
    { userId: "user_1", chatId: "chat-1" as Id<"chats">, now: state.now + 1 },
  );
  assert.deepEqual(pending[0].nativeAgent, {
    origin: "codex_native_agent",
    nativeThreadId: "child-thread-1",
    label: "Reviewer · Code review",
    nickname: "Reviewer",
    role: "Code review",
  });
  assert.equal(pending[0].nativeAgentThreadId, "child-thread-1");
  assert.equal(pending[0].canRespond, true);
});
