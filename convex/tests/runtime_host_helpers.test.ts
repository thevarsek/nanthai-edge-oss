import assert from "node:assert/strict";
import test, { mock } from "node:test";
import type { Id } from "../_generated/dataModel";
import { ingestRuntimeEventHandler } from "../runtime_host/chat_event_ingestion";
import { createPermissionFixture, permissionHost, permissionRequestedEvent } from "./runtime_host_permission_fixture";
import { durableWorkflow } from "../execution/components";
import { assertMemoryHelperExecution } from "../memory/helper_write_fence";
import { start } from "../runtime_host/helper_tasks";
import type { MutationCtx } from "../_generated/server";

for (const selection of [
  { modelId: "qwen3:1.7b", provider: "ollama", modelSelectionMode: "explicit" as const },
  { modelId: undefined, provider: undefined, modelSelectionMode: "adapter_default" as const },
]) {
  test(`Pi memory helpers retain the source ${selection.modelSelectionMode} model rather than selecting a cloud model`, async (t) => {
    t.after(() => mock.restoreAll());
    const state = await createPermissionFixture();
    Object.assign(state.rows.executionAttempts[0], { adapterId: "pi", ...selection });
    const presence = state.rows.runtimeDevicePresences[0];
    const adapters = presence.adapters as Array<Record<string, unknown>>;
    adapters[0].adapterId = "pi";
    mock.method(durableWorkflow, "start", async () => "workflow-helper");
    const handler = (start as unknown as { _handler: (ctx: MutationCtx, args: {
      userId: string; chatId: Id<"chats">; messageId: Id<"messages">;
      purpose: "memory"; messages: Array<{ role: string; content: string }>; input: string;
    }) => Promise<Id<"runtimeHelperTasks"> | null> })._handler;
    const taskId = await handler(state.ctx, {
      userId: "user_1", chatId: "chat-1" as Id<"chats">, messageId: "message-1" as Id<"messages">,
      purpose: "memory", messages: [{ role: "user", content: "I like orchids" }], input: "I like orchids",
    });
    assert.ok(taskId);
    const task = state.rows.runtimeHelperTasks.find(row => row._id === taskId);
    const attempt = state.rows.executionAttempts.find(row => row._id === task?.attemptId);
    assert.equal(attempt?.adapterId, "pi");
    assert.equal(attempt?.modelId, selection.modelId);
    assert.equal(attempt?.provider, selection.provider);
    assert.equal(attempt?.modelSelectionMode, selection.modelSelectionMode);
    assert.equal(attempt?.deviceId, "device-1");
  });
}

async function helperFixture() {
  const fixture = await createPermissionFixture();
  Object.assign(fixture.rows.executionRuns[0], { domainType: "local_helper", domainId: "helper-1", generationJobId: undefined });
  fixture.rows.generationJobs[0].status = "completed";
  fixture.rows.runtimeHelperTasks = [{
    _id: "helper-1", userId: "user_1", chatId: "chat-1", sourceMessageId: "message-1", sourceJobId: "job-1",
    runId: "run-1", attemptId: "attempt-1", fence: 7, commandRecordId: "command-1",
    completionEventId: "event-1", purpose: "memory", content: "", status: "waiting", createdAt: fixture.now,
  }];
  return fixture;
}

function textEvent(now: number, sequence = 0) {
  const event = permissionRequestedEvent(sequence, now);
  event.payload = {
    ...event.payload,
    payload: { sessionId: "attempt-1", event: {
      protocolVersion: "nanthai.runtime.v1", eventId: `text-${sequence}`, sequence,
      occurredAt: now, runId: "run-1", attemptId: "attempt-1", fence: 7, sessionId: "attempt-1",
      type: "text_delta", messageId: "helper-output", delta: '[{"content":"QA shared fact"}]',
    } },
  };
  return event;
}

test("local helper output is isolated from chat messages and replay does not duplicate it", async () => {
  const state = await helperFixture();
  const event = textEvent(state.now);
  await ingestRuntimeEventHandler(state.ctx, { ...permissionHost, event });
  await ingestRuntimeEventHandler(state.ctx, { ...permissionHost, event });
  assert.equal(state.rows.runtimeHelperTasks[0].content, '[{"content":"QA shared fact"}]');
  assert.equal(state.rows.messages[0].content, "");
  assert.equal(state.rows.generationJobs[0].status, "completed");
});

test("helper completion releases its native session and wakes Workflow while retaining the commit fence", async (t) => {
  t.after(() => mock.restoreAll());
  const state = await helperFixture();
  const signals: unknown[] = [];
  mock.method(durableWorkflow, "sendEvent", async (_ctx: unknown, args: unknown) => { signals.push(args); });
  const base = permissionRequestedEvent(0, state.now);
  const event = { ...base, payload: {
    ...base.payload, kind: "terminal_event", payload: { sessionId: "attempt-1", event: {
      protocolVersion: "nanthai.runtime.v1", eventId: "terminal-helper", sequence: 0,
      occurredAt: state.now, runId: "run-1", attemptId: "attempt-1", fence: 7, sessionId: "attempt-1",
      type: "terminal", outcome: "completed", summary: "Helper completed", checkpointRef: null, errorCode: null,
    } },
  } };
  await ingestRuntimeEventHandler(state.ctx, { ...permissionHost, event });
  assert.equal(state.rows.runtimeHelperTasks[0].status, "ready");
  assert.equal(state.rows.executionRuns[0].state, "running");
  assert.equal(state.rows.runtimeSessionBindings[0].status, "released");
  assert.equal(signals.length, 1);
});

test("helper output requires the exact command and fence; cancellation discards later text", async () => {
  const state = await helperFixture();
  const event = textEvent(state.now);
  await assert.rejects(ingestRuntimeEventHandler(state.ctx, { ...permissionHost, event: { ...event, fence: 8 } }), /MISMATCH/);
  state.rows.executionRuns[0].state = "cancelling";
  await ingestRuntimeEventHandler(state.ctx, { ...permissionHost, event });
  assert.equal(state.rows.runtimeHelperTasks[0].content, "");
  await assert.rejects(assertMemoryHelperExecution(state.ctx, { executionAttemptId: "attempt-1" as Id<"executionAttempts">, executionFence: 7 }, "user_1"));
});

test("helper packets bind the canonical source and isolate helper prompts from Persona instructions", async () => {
  const state = await helperFixture();
  Object.assign(state.rows.executionAttempts[0], { modelId: "gpt-6-luna", provider: "openai", modelSelectionMode: "explicit" });
  const { buildHelperPacket } = await import("../runtime_host/helper_packet");
  const { computeRuntimePacketHash } = await import("../runtime_host/production_packet");
  const task = { ...state.rows.runtimeHelperTasks[0], messages: [{ role: "system", content: "Extract facts as JSON" }, { role: "user", content: "I like orchids" }] };
  const packet = await buildHelperPacket({
    task: task as unknown as import("../_generated/dataModel").Doc<"runtimeHelperTasks">,
    attempt: state.rows.executionAttempts[0] as unknown as import("../_generated/dataModel").Doc<"executionAttempts">,
    run: state.rows.executionRuns[0] as unknown as import("../_generated/dataModel").Doc<"executionRuns">,
    personaId: "persona-1" as Id<"personas">,
  });
  assert.equal(packet.messages.at(-1)?.messageId, packet.sourceMessageId);
  assert.equal(packet.instructions.system[0].text, "Extract facts as JSON");
  assert.deepEqual(packet.instructions.persona, []);
  assert.equal(packet.placement.selectedModel.modelId, "gpt-6-luna");
  assert.equal(packet.command.packetHash, await computeRuntimePacketHash(packet));
});


test("worker settlement leaves a ready helper running until Workflow commits", async () => {
  const state = await helperFixture();
  state.rows.runtimeHelperTasks[0].status = "ready";
  const { settleAttempt } = await import("../runtime_host/host_execution");
  const handler = (settleAttempt as unknown as { _handler: (ctx: import("../_generated/server").MutationCtx, args: typeof permissionHost & { attemptId: Id<"executionAttempts">; fence: number; outcome: "completed" }) => Promise<null> })._handler;
  await handler(state.ctx, { ...permissionHost, attemptId: "attempt-1" as Id<"executionAttempts">, fence: 7, outcome: "completed" });
  assert.equal(state.rows.executionRuns[0].state, "running");
  assert.equal(state.rows.executionAttempts[0].status, "running");
  assert.equal(state.rows.runtimeSessionBindings[0].status, "active");
});

test("authenticated late helper output is ACK-only after terminal settlement and cannot block replay", async () => {
  const state = await helperFixture();
  state.rows.executionRuns[0].state = "failed";
  state.rows.runtimeHelperTasks[0].status = "failed";
  const event = textEvent(state.now);
  await ingestRuntimeEventHandler(state.ctx, { ...permissionHost, event });
  assert.equal(state.rows.runtimeHelperTasks[0].content, "");
  assert.equal(state.rows.messages[0].content, "");
  const wrong = { ...event, fence: 8 };
  await assert.rejects(ingestRuntimeEventHandler(state.ctx, { ...permissionHost, event: wrong }), /MISMATCH/);
});

test("helper expiry closes through the existing run-tree cancellation driver", async (t) => {
  t.after(() => mock.restoreAll());
  const state = await helperFixture();
  const scheduled: unknown[] = [];
  mock.method(state.ctx, "runMutation", async () => ({ components: [], done: false }));
  mock.method(state.ctx.scheduler, "runAfter", async (_delay: number, _reference: unknown, args: unknown) => { scheduled.push(args); return "scheduled_1"; });
  const { expire } = await import("../runtime_host/helper_tasks");
  const handler = (expire as unknown as { _handler: (ctx: import("../_generated/server").MutationCtx, args: { taskId: Id<"runtimeHelperTasks"> }) => Promise<null> })._handler;
  await handler(state.ctx, { taskId: "helper-1" as Id<"runtimeHelperTasks"> });
  assert.equal(state.rows.runtimeHelperTasks[0].status, "failed");
  assert.deepEqual(scheduled, [{ runId: "run-1", requestedBy: "user_1", reason: "Local helper transport deadline expired" }]);
});

test("failed helper finalization closes its command and stays idempotent without changing the public reply", async () => {
  const state = await helperFixture();
  const { finish } = await import("../runtime_host/helper_tasks");
  const handler = (finish as unknown as { _handler: (ctx: import("../_generated/server").MutationCtx, args: { taskId: Id<"runtimeHelperTasks">; failed: boolean }) => Promise<null> })._handler;
  await handler(state.ctx, { taskId: "helper-1" as Id<"runtimeHelperTasks">, failed: true });
  assert.equal(state.rows.runtimeCommands[0].status, "rejected");
  assert.equal(state.rows.executionRuns[0].state, "failed");
  assert.equal(state.rows.generationJobs[0].status, "completed");
  await handler(state.ctx, { taskId: "helper-1" as Id<"runtimeHelperTasks">, failed: true });
  assert.equal(state.rows.runtimeCommands[0].status, "rejected");
});
