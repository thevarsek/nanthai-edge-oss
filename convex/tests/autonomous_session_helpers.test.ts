import assert from "node:assert/strict";
import test from "node:test";

import {
  cancelInFlightAutonomousTurns,
  resolveInitialParentMessageIds,
} from "../autonomous/session_helpers";
import {
  completeSessionFailedIfRunning,
  shouldSessionContinue,
} from "../autonomous/actions_run_cycle_session";

test("shouldSessionContinue proxies the shouldContinue mutation result", async () => {
  const ctx = {
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      assert.equal(args.sessionId, "session_1");
      return true;
    },
  } as any;

  const result = await shouldSessionContinue(ctx, "session_1" as any);
  assert.equal(result, true);
});

test("completeSessionFailedIfRunning only completes sessions still marked running", async () => {
  const calls: Record<string, unknown>[] = [];
  const runningCtx = {
    runQuery: async () => ({ _id: "session_1", status: "running" }),
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      calls.push(args);
    },
  } as any;
  const pausedCtx = {
    runQuery: async () => ({ _id: "session_1", status: "paused" }),
    runMutation: async () => {
      throw new Error("should not complete a paused session");
    },
  } as any;

  await completeSessionFailedIfRunning(runningCtx, "session_1" as any, "boom");
  await completeSessionFailedIfRunning(pausedCtx, "session_1" as any, "ignored");

  assert.deepEqual(calls, [
    {
      sessionId: "session_1",
      status: "failed",
      error: "boom",
      stopReason: "Autonomous cycle failed",
    },
  ]);
});

test("resolveInitialParentMessageIds prefers an in-chat active leaf and keeps multimodel siblings", async () => {
  const messages = [
    { _id: "old_user", chatId: "chat_1", createdAt: 1 },
    { _id: "assistant_a", chatId: "chat_1", createdAt: 2, multiModelGroupId: "group_1" },
    { _id: "assistant_b", chatId: "chat_1", createdAt: 3, multiModelGroupId: "group_1" },
  ];

  const ctx = {
    db: {
      get: async (id: string) => messages.find((message) => message._id === id) ?? null,
      query: (_table: string) => ({
        withIndex: () => ({
          order: () => ({
            take: async () => [messages[messages.length - 1]],
          }),
          collect: async () => messages,
        }),
      }),
    },
  } as any;

  const result = await resolveInitialParentMessageIds(
    ctx,
    "chat_1" as any,
    "assistant_b" as any,
  );

  assert.deepEqual(result, ["assistant_b", "assistant_a"]);
});

test("resolveInitialParentMessageIds falls back to the latest chat message when the active leaf is foreign", async () => {
  const latest = { _id: "latest_message", chatId: "chat_1", createdAt: 5 };
  const ctx = {
    db: {
      get: async (_id: string) => ({ _id: "foreign", chatId: "chat_2" }),
      query: (_table: string) => ({
        withIndex: () => ({
          order: () => ({
            take: async () => [latest],
          }),
          collect: async () => [latest],
        }),
      }),
    },
  } as any;

  const result = await resolveInitialParentMessageIds(
    ctx,
    "chat_1" as any,
    "foreign" as any,
  );

  assert.deepEqual(result, ["latest_message"]);
});

test("cancelInFlightAutonomousTurns cancels only jobs and messages owned by the turn order", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const nowBefore = Date.now();
  const messagesById: Record<string, Record<string, unknown>> = {
    msg_streaming: {
      _id: "msg_streaming",
      chatId: "chat_1",
      autonomousParticipantId: "p1",
      status: "streaming",
    },
    msg_queued: {
      _id: "msg_queued",
      chatId: "chat_1",
      autonomousParticipantId: "p2",
      status: "pending",
    },
    msg_unrelated: {
      _id: "msg_unrelated",
      chatId: "chat_1",
      autonomousParticipantId: "p9",
      status: "streaming",
    },
    msg_pending_direct: {
      _id: "msg_pending_direct",
      chatId: "chat_1",
      autonomousParticipantId: "p2",
      status: "pending",
    },
  };

  const ctx = {
    db: {
      get: async (id: string) => messagesById[id] ?? null,
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
      query: (table: string) => ({
        withIndex: (_index: string, apply: (query: any) => any) => {
          let status = "";
          apply({
            eq: (_field: string, _chatId: string) => ({
              eq: (_statusField: string, nextStatus: string) => {
                status = nextStatus;
                return {};
              },
            }),
          });
          return {
            collect: async () => {
              if (table === "generationJobs" && status === "streaming") {
                return [{ _id: "job_streaming", messageId: "msg_streaming" }];
              }
              if (table === "generationJobs" && status === "queued") {
                return [
                  { _id: "job_queued", messageId: "msg_queued" },
                  { _id: "job_unrelated", messageId: "msg_unrelated" },
                ];
              }
              if (table === "messages" && status === "pending") {
                return [messagesById.msg_pending_direct];
              }
              if (table === "messages" && status === "streaming") {
                return [messagesById.msg_unrelated];
              }
              return [];
            },
          };
        },
      }),
    },
  } as any;

  await cancelInFlightAutonomousTurns(ctx, "chat_1" as any, ["p1", "p2"]);

  assert.equal(
    patches.some((entry) => entry.id === "job_streaming" && entry.value.status === "cancelled"),
    true,
  );
  assert.equal(
    patches.some((entry) => entry.id === "job_queued" && entry.value.status === "cancelled"),
    true,
  );
  assert.equal(
    patches.some((entry) => entry.id === "job_unrelated"),
    false,
  );
  assert.equal(
    patches.some((entry) => entry.id === "msg_pending_direct" && entry.value.content === ""),
    true,
  );
  assert.equal(
    patches.some((entry) => entry.id === "msg_unrelated"),
    false,
  );
  for (const entry of patches.filter((item) => "completedAt" in item.value)) {
    assert.ok((entry.value.completedAt as number) >= nowBefore);
  }
});
