import assert from "node:assert/strict";
import test from "node:test";
import type { NonTerminalAdapterEvent } from "../runtime_host/protocol_adapter_events";
import { ingestRuntimeEventHandler } from "../runtime_host/chat_event_ingestion";
import { aggregateRuntimeUsage } from "../runtime_host/usage_aggregation";
import { reconcileRuntimeUsageHandler } from "../runtime_host/usage_reconciliation";
import { fixture, oldHost, workerEvent } from "./runtime_host_event_replay_fixture";

type UsageEvent = Extract<NonTerminalAdapterEvent, { type: "usage_reported" }>;

function usage(sequence: number, input: number, output: number): UsageEvent {
  return {
    protocolVersion: "nanthai.runtime.v1", eventId: `usage-${sequence}`,
    sequence, occurredAt: 1_786_752_000_000 + sequence,
    runId: "run-1", attemptId: "attempt-1", fence: 7, sessionId: "attempt-1",
    type: "usage_reported",
    actualModel: { provider: "openai", modelId: "gpt-6.1-sol", reportedByAdapter: true },
    tokens: { input, output, cachedInput: 0, reasoning: 0, total: input + output },
    cost: { source: "unpriced", reason: "Codex did not report session cost" },
  };
}

test("canonical local usage sums all inferences once, including worker replay", async () => {
  const { ctx, rows } = await fixture();
  const reports = [[26076, 47, 9600, 0], [30108, 81, 25856, 14],
    [33891, 58, 29952, 14], [40121, 29, 33664, 0]];
  for (const [index, [input, output, cachedInput, reasoning]] of reports.entries()) {
    const sequence = 5 + index;
    const event = usage(sequence, input, output);
    event.tokens.cachedInput = cachedInput;
    event.tokens.reasoning = reasoning;
    const envelope = {
      ...workerEvent(sequence, "command_result"),
      payload: {
        wireVersion: "nanthai.runtime.process.v1", messageId: `worker-${sequence}`,
        sequence, sentAt: event.occurredAt,
        kind: "adapter_event", payload: { sessionId: "attempt-1", event },
      },
    };
    await ingestRuntimeEventHandler(ctx, { ...oldHost, event: envelope });
    await ingestRuntimeEventHandler(ctx, { ...oldHost, event: envelope });
  }
  await ingestRuntimeEventHandler(ctx, { ...oldHost, event: workerEvent(9, "terminal_event") });
  assert.deepEqual(rows.messages[0].usage, {
    promptTokens: 130196, completionTokens: 215, totalTokens: 130411,
    cachedTokens: 99072, reasoningTokens: 28,
  });
  assert.equal(rows.usageRecords.length, 1);
  assert.equal(rows.usageRecords[0].costAttribution, "unpriced");
  assert.equal(rows.usageRecords[0].totalTokens, 130411);
});

test("stopped and failed runtime turns retain observed usage once without reviving the run", async () => {
  for (const outcome of ["cancelled", "failed"] as const) {
    const { ctx, rows } = await fixture();
    rows.generationJobs[0].runtimeUsage = {
      actualProvider: "openai", actualModelId: "gpt-6.1-sol",
      inputTokens: 12, outputTokens: 3, totalTokens: 15,
      costSource: "unpriced", unpricedReason: "Subscription consumption",
    };
    if (outcome === "cancelled") {
      rows.generationJobs[0].status = "cancelled";
      rows.executionRuns[0].state = "cancelling";
    }
    const terminal = workerEvent(5, "terminal_event");
    if (!("event" in terminal.payload.payload) || !terminal.payload.payload.event) {
      throw new Error("Terminal fixture required");
    }
    terminal.payload.payload.event.outcome = outcome;
    await ingestRuntimeEventHandler(ctx, { ...oldHost, event: terminal });
    await ingestRuntimeEventHandler(ctx, { ...oldHost, event: terminal });
    assert.equal(rows.messages[0].status, outcome);
    assert.equal(rows.executionRuns[0].state, outcome);
    assert.equal(rows.usageRecords.length, 1);
    assert.equal(rows.usageRecords[0].source, "runtime_generation");
    assert.equal(rows.usageRecords[0].totalTokens, 15);
    assert.equal(rows.usageRecords[0].cost, undefined);
  }
});

test("runtime usage reconciliation restores failed observations and original route without changing history", async () => {
  const { ctx, rows } = await fixture();
  rows.generationJobs[0].status = "failed";
  rows.generationJobs[0].runtimeUsage = {
    actualProvider: "openai", actualModelId: "gpt-6.1-sol",
    inputTokens: 12, outputTokens: 3, totalTokens: 15, costSource: "unpriced",
  };
  const before = structuredClone(rows.messages[0]);
  const jobId = rows.generationJobs[0]._id as Parameters<typeof reconcileRuntimeUsageHandler>[1]["jobId"];
  await reconcileRuntimeUsageHandler(ctx, { jobId });
  rows.usageRecords[0].runtimeDeviceId = undefined;
  await reconcileRuntimeUsageHandler(ctx, { jobId });
  assert.equal(rows.usageRecords.length, 1);
  assert.equal(rows.usageRecords[0].runtimeDeviceId, "device-1");
  assert.equal(rows.usageRecords[0].runtimeAdapterId, "codex");
  assert.equal(rows.usageRecords[0].totalTokens, 15);
  assert.equal(rows.usageRecords[0].cost, undefined);
  assert.deepEqual(rows.messages[0], before);
  rows.executionAttempts[0].userId = "another-user";
  await assert.rejects(reconcileRuntimeUsageHandler(ctx, { jobId }), /OWNER_MISMATCH/);
});

test("usage preserves unknown components and never treats an unknown cost as zero", () => {
  const first = usage(5, 10, 2);
  first.tokens.cachedInput = null;
  first.tokens.reasoning = null;
  const second = usage(6, 20, 3);
  second.tokens.cachedInput = null;
  second.tokens.reasoning = null;
  second.cost = { source: "provider_reported", amount: 0.01, currency: "USD" };
  const combined = aggregateRuntimeUsage(aggregateRuntimeUsage(undefined, first), second);
  assert.equal(combined.totalTokens, 35);
  assert.equal(combined.cachedInputTokens, undefined);
  assert.equal(combined.reasoningTokens, undefined);
  assert.equal(combined.costSource, "unpriced");
  assert.equal(combined.costAmount, undefined);
});

test("native child usage is canonical, replay-safe and separate from parent finalization", async () => {
  const { ctx, rows } = await fixture();
  rows.runtimeNativeAgentGroups = [{
    _id: "group-1", attemptId: "attempt-1", runId: "run-1", fence: 7,
    userId: "user-1", chatId: "chat-1", messageId: "message-1", status: "active",
  }];
  rows.runtimeNativeAgents = [{
    _id: "child-1", groupId: "group-1", nativeThreadId: "native-child-1",
    userId: "user-1", chatId: "chat-1", messageId: "message-1", status: "running",
  }];
  const child = { ...usage(5, 27623, 8), nativeAgentThreadId: "native-child-1",
    actualModel: null };
  const parent = usage(6, 112746, 162);
  for (const event of [child, child, parent]) {
    const sequence = event.sequence;
    const envelope = { ...workerEvent(sequence, "command_result"), payload: {
      wireVersion: "nanthai.runtime.process.v1", messageId: `worker-${sequence}`,
      sequence, sentAt: event.occurredAt, kind: "adapter_event",
      payload: { sessionId: "attempt-1", event },
    } };
    assert.equal(await ingestRuntimeEventHandler(ctx, { ...oldHost, event: envelope }), true);
  }
  assert.equal(rows.usageRecords.length, 1);
  assert.equal(rows.usageRecords[0].source, "runtime_native_child");
  assert.equal(rows.usageRecords[0].modelId, "unknown");
  assert.equal(rows.usageRecords[0].cost, undefined);
  assert.equal(rows.usageRecords[0].runtimeDeviceId, "device-1");
  await ingestRuntimeEventHandler(ctx, { ...oldHost, event: workerEvent(7, "terminal_event") });
  assert.equal(rows.usageRecords.length, 2);
  assert.equal(rows.messages[0].usage &&
    (rows.messages[0].usage as { totalTokens: number }).totalTokens, 112908);
  assert.equal(rows.usageRecords.reduce((n, row) => n + Number(row.totalTokens), 0), 140539);
});

test("only compatible complete price reports are summed", () => {
  const first = usage(5, 10, 2);
  first.cost = { source: "api_equivalent_estimate", amount: 0.01, currency: "USD", pricingVersion: "v1" };
  const second = usage(6, 20, 3);
  second.cost = { ...first.cost, amount: 0.02 };
  const combined = aggregateRuntimeUsage(aggregateRuntimeUsage(undefined, first), second);
  assert.equal(combined.costSource, "api_equivalent_estimate");
  assert.equal(combined.costAmount, 0.03);
  const differentCurrency = { ...second, cost: { ...second.cost, currency: "EUR" } };
  assert.equal(aggregateRuntimeUsage(combined, differentCurrency).costSource, "unpriced");
  const differentRate = { ...second, cost: { ...second.cost, pricingVersion: "v2" } };
  assert.equal(aggregateRuntimeUsage(combined, differentRate).costSource, "unpriced");
});
