import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { cancelActiveGenerationHandler } from "../chat/mutations_public_handlers";
import { requestRunTreeTeardown } from "../execution/teardown_graph";
import { LOCAL_CANCEL_COMMAND_WINDOW_MS } from "../runtime_host/chat_cancellation";

type Rows = Record<string, Array<Record<string, unknown>>>;

test("one Chat Stop fences and cancels two concurrent local participant runs without inline pagination", async () => {
  const now = Date.now();
  const rows = cancellationRows(now);
  const raw = createStatefulMockCtx(rows, { runQuery: async () => false });
  forbidInlinePagination(raw as unknown as MutationCtx);
  const ctx = raw as unknown as MutationCtx;

  assert.equal(LOCAL_CANCEL_COMMAND_WINDOW_MS, 30_000);
  assert.deepEqual(await cancelActiveGenerationHandler(ctx, {
    chatId: "chat_1" as Id<"chats">,
  }), {
    cancelledCount: 2,
  });
  assert.ok(rows.executionRuns.every((run) => run.state === "cancelling"));
  const cancels = rows.runtimeCommands.filter((command) => command.type === "cancel");
  assert.deepEqual(cancels.map((command) => command.commandId), [
    "cancel-job_1-1", "cancel-job_2-1",
  ]);
  assert.equal(raw.scheduled.length, 2);
  assert.ok(raw.scheduled.every((scheduled) =>
    scheduled.runId === "run_1" || scheduled.runId === "run_2",
  ));
  assert.equal(rows.executionTeardownTasks.length, 0);

  assert.deepEqual(await cancelActiveGenerationHandler(ctx, {
    chatId: "chat_1" as Id<"chats">,
  }), {
    cancelledCount: 0,
  });
  assert.equal(rows.runtimeCommands.filter((command) => command.type === "cancel").length, 2);
  assert.equal(raw.scheduled.length, 2);
});

test("run-tree Stop queues one cancel per Codex/Pi leaf before revoking its turn claim", async () => {
  const rows = cancellationRows(Date.now());
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx;
  for (const index of [1, 2]) {
    for (let pass = 0; pass < 4; pass++) {
      await requestRunTreeTeardown(ctx, `run_${index}` as Id<"executionRuns">,
        "user_1", "Collaboration stopped by user");
    }
  }
  assert.deepEqual(rows.runtimeCommands.filter(command => command.type === "cancel")
    .map(command => command.commandId), ["cancel-job_1-1", "cancel-job_2-1"]);
  assert.ok(rows.executionRuns.every(run => run.state === "cancelling"));
  assert.ok(rows.runtimeCommands.filter(command => command.type === "start")
    .every(command => command.status === "acknowledged"));
  assert.ok(rows.runtimeSessionBindings.every(binding => binding.status === "active"));
  for (const command of rows.runtimeCommands.filter(command => command.type === "cancel")) {
    command.expiresAt = Date.now() - 1;
  }
  for (const index of [1, 2]) {
    await requestRunTreeTeardown(ctx, `run_${index}` as Id<"executionRuns">,
      "user_1", "Collaboration stopped by user");
  }
  assert.ok(rows.runtimeCommands.every(command => command.status === "rejected"));
  assert.ok(rows.runtimeSessionBindings.every(binding => binding.status === "revoked"));
});

function forbidInlinePagination(ctx: MutationCtx): void {
  type QueryChain = { paginate?: (...args: unknown[]) => Promise<unknown> };
  type Database = { query: (table: string) => QueryChain };
  const database = ctx.db as unknown as Database;
  const query = database.query.bind(database);
  database.query = (table) => {
    const chain = query(table);
    if (chain.paginate) {
      chain.paginate = async () => {
        throw new Error("Stop must defer paginated teardown per execution run");
      };
    }
    return chain;
  };
}

function cancellationRows(now: number): Rows {
  return {
    chats: [{ _id: "chat_1", userId: "user_1", title: "Pair review", mode: "chat" }],
    messages: [1, 2].map((index) => ({
      _id: `message_${index}`, userId: "user_1", chatId: "chat_1",
      role: "assistant", content: "partial", status: "streaming", createdAt: now,
    })),
    generationJobs: [1, 2].map((index) => ({
      _id: `job_${index}`, userId: "user_1", chatId: "chat_1",
      messageId: `message_${index}`, modelId: "openai/gpt-5.6",
      status: "streaming", analyticsStartedAt: now, createdAt: now,
      executionRunId: `run_${index}`, executionAttemptId: `attempt_${index}`,
      executionFence: 1, runtimeCommandRecordId: `turn_command_${index}`,
    })),
    executionRuns: [1, 2].map((index) => ({
      _id: `run_${index}`, userId: "user_1", chatId: "chat_1",
      generationJobId: `job_${index}`, activeAttemptId: `attempt_${index}`,
      kind: "chat_generation", state: "running", requestedPlacement: "local",
      nextAttemptNumber: 2, nextFence: 2, nextEventSequence: 1,
      createdAt: now, updatedAt: now,
    })),
    executionAttempts: [1, 2].map((index) => ({
      _id: `attempt_${index}`, runId: `run_${index}`, userId: "user_1",
      attemptNumber: 1, executorKind: "local_runtime", placement: "local",
      adapterId: index === 1 ? "codex" : "pi", deviceId: "device-1", status: "running",
      claimantId: "runtime-host:device-1:presence-1", fence: 1,
      leaseExpiresAt: now + 60_000, createdAt: now, updatedAt: now,
    })),
    runtimeCommands: [1, 2].map((index) => ({
      _id: `turn_command_${index}`, runId: `run_${index}`,
      attemptId: `attempt_${index}`, userId: "user_1",
      commandId: `turn-job_${index}-1`, expectedFence: 1, type: "start",
      status: "acknowledged", authorizationSource: "explicit_user_turn",
      initiatedBy: "user_1", inputHash: "hash",
      targetDeviceId: "device-1", claimedBy: "runtime-host:device-1:presence-1",
      createdAt: now, updatedAt: now,
    })),
    runtimeDevices: [{
      _id: "device_row_1", userId: "user_1", deviceId: "device-1",
      displayName: "Mac", status: "active",
    }],
    runtimeDevicePresences: [{
      _id: "presence_row_1", userId: "user_1", runtimeDeviceId: "device_row_1",
      presenceSessionId: "presence-1", status: "online", expiresAt: now + 60_000,
    }],
    runtimeSessionBindings: [1, 2].map(index => ({
      _id: `binding_${index}`, runId: `run_${index}`, attemptId: `attempt_${index}`,
      status: "active",
    })),
    accountDeletionTombstones: [], executionTeardownTasks: [], runEvents: [],
    generationContinuations: [], streamingMessages: [], subagentBatches: [],
    subagentRuns: [], drivePickerBatches: [], videoJobs: [], searchSessions: [],
    advisorBatches: [], advisorRuns: [],
  };
}
