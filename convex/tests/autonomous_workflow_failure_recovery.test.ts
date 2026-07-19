import assert from "node:assert/strict";
import test from "node:test";

import { reconcileAutonomousSessionWorkflowFailure } from
  "../autonomous/execution_lifecycle";

test("an autonomous Workflow fault cleans dispatched turns before failing the session", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const queryCounts = new Map<string, number>();
  const messages: Record<string, Record<string, unknown>> = {
    message_streaming: {
      _id: "message_streaming",
      autonomousParticipantId: "participant_1",
      status: "streaming",
    },
    message_queued: {
      _id: "message_queued",
      autonomousParticipantId: "participant_2",
      status: "pending",
    },
    message_pending: {
      _id: "message_pending",
      autonomousParticipantId: "participant_2",
      status: "pending",
    },
    message_unrelated: {
      _id: "message_unrelated",
      autonomousParticipantId: "participant_9",
      status: "streaming",
    },
  };
  const rowsByQuery = {
    generationJobs: [
      [{ _id: "job_streaming", messageId: "message_streaming" }],
      [
        { _id: "job_queued", messageId: "message_queued" },
        { _id: "job_unrelated", messageId: "message_unrelated" },
      ],
    ],
    messages: [
      [messages.message_pending],
      [messages.message_unrelated],
    ],
  };
  const ctx = {
    db: {
      get: async (id: string) => messages[id] ?? null,
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
      query: (table: keyof typeof rowsByQuery) => ({
        withIndex: () => ({
          collect: async () => {
            const index = queryCounts.get(table) ?? 0;
            queryCounts.set(table, index + 1);
            return rowsByQuery[table][index] ?? [];
          },
        }),
      }),
    },
  };

  await reconcileAutonomousSessionWorkflowFailure(
    ctx as never,
    {
      _id: "session_1",
      status: "running",
      chatId: "chat_1",
      turnOrder: ["participant_1", "participant_2"],
    } as never,
    { cancelled: false, summary: "Workflow interrupted: transport fault", now: 1234 },
  );

  for (const id of ["job_streaming", "job_queued"]) {
    const patch = patches.find((entry) => entry.id === id);
    assert.equal(patch?.value.status, "cancelled");
    assert.equal(typeof patch?.value.completedAt, "number");
  }
  for (const id of ["message_streaming", "message_queued", "message_pending"]) {
    const patch = patches.find((entry) => entry.id === id);
    assert.equal(patch?.value.status, "cancelled");
    assert.equal(patch?.value.content, "");
  }
  assert.equal(patches.some((entry) => entry.id === "job_unrelated"), false);
  assert.equal(patches.some((entry) => entry.id === "message_unrelated"), false);
  assert.deepEqual(
    patches.find((entry) => entry.id === "session_1")?.value,
    {
      status: "failed",
      stopReason: undefined,
      error: "Workflow interrupted: transport fault",
      updatedAt: 1234,
    },
  );
});
