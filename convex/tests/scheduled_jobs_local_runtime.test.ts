import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createMockCtx, createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { enqueueStep } from "../scheduledJobs/actions_execution";
import { createScheduledExecutionTurn } from "../scheduledJobs/execution_turn";
import { requiresOpenRouterForExecution } from "../scheduledJobs/execution_routing";
import { commitScheduledExecutionFailure } from "../scheduledJobs/execution_terminal_commit";

type Rows = Record<string, Array<Record<string, unknown>>>;
const turnHandler = (createScheduledExecutionTurn as unknown as {
  _handler: (ctx: MutationCtx, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
})._handler;
const failHandler = (commitScheduledExecutionFailure as unknown as {
  _handler: (ctx: MutationCtx, args: Record<string, unknown>) => Promise<boolean>;
})._handler;

function fixture(online = true) {
  const rows: Rows = {
    scheduledJobs: [{
      _id: "schedule-1", userId: "user_1", status: "active",
      activeExecutionId: "occurrence-1", activeExecutionChatId: "chat-1",
      executionRunId: "parent-1", steps: [{
        modelId: "openai/gpt-6.1-sol", personaId: "persona-1", prompt: "Say hello",
        searchMode: "basic",
      }],
    }],
    chats: [{ _id: "chat-1", userId: "user_1" }],
    personas: [{
      _id: "persona-1", userId: "user_1", displayName: "Current Codex",
      modelId: "openai/gpt-6.1-sol", systemPrompt: "Current instructions",
    }],
    personaRuntimeBindings: [{
      _id: "binding-1", personaId: "persona-1", userId: "user_1", status: "active",
      deviceId: "device-1", adapterId: "codex", routeHash: "route-1",
      modelSelectionMode: "explicit", provider: "openai", modelId: "gpt-6.1-sol",
    }],
    runtimeDevices: [{
      _id: "device-row-1", userId: "user_1", deviceId: "device-1", status: "active",
      displayName: "Test Mac", currentPresenceId: "presence-1",
    }],
    runtimeDevicePresences: [{
      _id: "presence-1", status: online ? "online" : "offline", expiresAt: Date.now() + 120_000,
      adapters: [{ adapterId: "codex", authState: "ready" }],
    }],
    executionRuns: [{ _id: "parent-1", userId: "user_1", state: "running" }],
  };
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx;
  const job = rows.scheduledJobs[0] as unknown as Doc<"scheduledJobs">;
  return { rows, ctx, job };
}

const turnArgs = {
  jobId: "schedule-1", chatId: "chat-1", userId: "user_1", executionId: "occurrence-1",
  stepIndex: 0, stepTitle: "Step 1", content: "Say hello",
  modelId: "old-model", personaId: "persona-1", personaName: "Old name",
  useParticipantRoute: true,
};

test("local None/Basic schedule steps require no OpenRouter; cloud/mixed/Deep retain the requirement", async () => {
  const { ctx, rows, job } = fixture();
  assert.equal(await requiresOpenRouterForExecution(ctx, job), false);
  const steps = job.steps;
  assert.ok(steps);
  steps[0].searchMode = "none";
  assert.equal(await requiresOpenRouterForExecution(ctx, job), false);
  steps[0].searchMode = "web";
  assert.equal(await requiresOpenRouterForExecution(ctx, job), true);
  steps[0].searchMode = "basic";
  steps.push({ modelId: "openai/gpt-6.1-sol", prompt: "Cloud step" });
  assert.equal(await requiresOpenRouterForExecution(ctx, job), true);
  steps.pop();
  rows.personaRuntimeBindings = [];
  assert.equal(await requiresOpenRouterForExecution(ctx, job), true);
});

test("scheduled local turn snapshots current Persona, owns a child run and replays without duplicating it", async () => {
  const { ctx, rows } = fixture();
  const result = await turnHandler(ctx, turnArgs);
  assert.equal(result.created, true);
  assert.equal(result.chatParticipantId, "chatParticipants_1");
  assert.equal(rows.generationJobs[0].chatParticipantId, result.chatParticipantId);
  assert.equal(rows.generationJobs[0].modelId, "openai/gpt-6.1-sol");
  assert.equal((rows.generationJobs[0].effectivePersonaConfig as Record<string, unknown>).systemPrompt, "Current instructions");
  const child = rows.executionRuns[1];
  assert.equal(child.parentRunId, "parent-1");
  assert.equal(child.requestedPlacement, "local");
  assert.equal(rows.executionAttempts[0].orchestrationEngine, "runtime_adapter");
  assert.equal(rows.executionAttempts[0].deviceId, "device-1");
  assert.equal(rows.messages.find((row) => row.role === "assistant")?.chatParticipantId, result.chatParticipantId);
  const duplicate = await turnHandler(ctx, turnArgs);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.genJobId, result.genJobId);
  assert.equal(duplicate.chatParticipantId, result.chatParticipantId);
  assert.equal(rows.messages.length, 2);
  assert.equal(rows.executionRuns.length, 2);
});

test("offline occurrence creates no generation or runtime command, records one failure and preserves its next occurrence", async () => {
  const { ctx, rows, job } = fixture(false);
  Object.assign(job, { consecutiveFailures: 2, nextRunAt: 123456, nextScheduledOccurrenceId: "next-1" });
  const result = await turnHandler(ctx, turnArgs);
  assert.equal(result.offline, true);
  assert.match(String(result.runtimeUnavailable), /Test Mac.*offline.*will not run later/);
  assert.equal(rows.generationJobs, undefined);
  assert.equal(rows.runtimeCommands, undefined);
  // This fixture leaves parent terminalization to its existing separately tested owner.
  delete job.executionRunId;
  const args = { jobId: job._id, executionId: "occurrence-1", error: result.runtimeUnavailable, runtimeUnavailable: result.offline };
  assert.equal(await failHandler(ctx, args), true);
  assert.equal(await failHandler(ctx, args), false);
  assert.equal(rows.jobRuns.length, 1);
  assert.equal(job.status, "active");
  assert.equal(job.consecutiveFailures, 2);
  assert.equal(job.nextRunAt, 123456);
  assert.equal(job.nextScheduledOccurrenceId, "next-1");
  assert.equal(job.activeExecutionId, undefined);
});

test("revoked and signed-out routes do not acquire the offline failure exemption", async () => {
  const { ctx, rows } = fixture();
  rows.runtimeDevices[0].status = "revoked";
  const result = await turnHandler(ctx, turnArgs);
  assert.equal(result.offline, false);
  assert.match(String(result.runtimeUnavailable), /device_unavailable/);
  assert.equal(rows.generationJobs, undefined);
  const signedOut = fixture();
  (signedOut.rows.runtimeDevicePresences[0].adapters as Array<Record<string, unknown>>)[0].authState = "signed_out";
  const signedOutResult = await turnHandler(signedOut.ctx, turnArgs);
  assert.equal(signedOutResult.offline, false);
  assert.match(String(signedOutResult.runtimeUnavailable), /adapter_signed_out/);
});

test("scheduled local turn rejects cancelled parents and stale/deleting occurrences before dispatch", async () => {
  for (const state of ["cancelling", "completed", "failed", "cancelled"]) {
    const { ctx, rows } = fixture();
    rows.executionRuns[0].state = state;
    await assert.rejects(turnHandler(ctx, turnArgs), /EXECUTION_PARENT_NOT_WRITABLE/);
    assert.equal(rows.executionAttempts, undefined);
    assert.equal(rows.runtimeCommands, undefined);
  }
  const stale = fixture();
  stale.job.activeExecutionId = "different-occurrence";
  await assert.rejects(turnHandler(stale.ctx, turnArgs), /no longer active/);
  assert.equal(stale.rows.messages, undefined);
  const deleting = fixture();
  deleting.job.isDeleting = true;
  await assert.rejects(turnHandler(deleting.ctx, turnArgs), /not found or unauthorized/);
  assert.equal(deleting.rows.messages, undefined);
});

test("offline dispatch returns a terminal outcome without queueing generation or waiting for a nonexistent message", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const ctx = createMockCtx({
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = getFunctionName(ref as never);
      calls.push({ name, args });
      if (name === "scheduledJobs/mutations:createScheduledExecutionTurn") {
        return { runtimeUnavailable: "Test Mac is offline", offline: true };
      }
      if (name === "scheduledJobs/execution_terminal_commit:commitScheduledExecutionFailure") return true;
      throw new Error(`Unexpected ${name}`);
    },
  });
  assert.equal(await enqueueStep(ctx, {
    jobId: "schedule-1" as Doc<"scheduledJobs">["_id"],
    chatId: "chat-1" as Doc<"chats">["_id"],
    userId: "user_1", executionId: "occurrence-1", stepIndex: 0,
    step: { modelId: "openai/gpt-6.1-sol", prompt: "Say hello", searchMode: "none" },
  }), false);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].args.runtimeUnavailable, true);
});
