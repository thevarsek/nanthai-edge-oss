import assert from "node:assert/strict";
import test, { mock } from "node:test";
import {
  cancelAdvisorBatchRows,
  stopAdvisorBatchConsultations,
} from "../advisors/lifecycle";
import { timeoutRun } from "../advisors/mutations_internal";
import { durableWorkflow } from "../execution/components";

type TestRecord = Record<string, unknown>;

const timeoutRunHandler = (timeoutRun as unknown as {
  _handler: (ctx: unknown, args: { runId: string }) => Promise<{ changed: boolean }>;
})._handler;

function terminalAnalyticsState(firstRunStatus = "streaming") {
  const records = new Map<string, TestRecord>([
    ["batch_1", {
      _id: "batch_1",
      userId: "user_1",
      chatId: "chat_1",
      assistantMessageIds: [],
      status: "running",
      generationSnapshot: { kind: "generation", args: {} },
    }],
    ["run_1", run("run_1", "persona_1", firstRunStatus)],
    ["run_2", run("run_2", "persona_2", "consulting")],
  ]);
  const scheduled: Array<Record<string, unknown>> = [];
  const ctx = {
    db: {
      get: async (id: string) => records.get(id) ?? null,
      patch: async (id: string, patch: TestRecord) => {
        records.set(id, { ...records.get(id), ...patch });
      },
      query: (table: string) => ({
        withIndex: () => ({
          collect: async () => table === "advisorRuns"
            ? [records.get("run_1"), records.get("run_2")]
            : [],
        }),
      }),
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
        return `scheduled_${scheduled.length}`;
      },
      cancel: async () => undefined,
    },
  };
  return { ctx, records, scheduled };
}

test("Stop Advisors emits terminal analytics for each unfinished consultation", async () => {
  const state = terminalAnalyticsState("completed");
  const stopped = await stopAdvisorBatchConsultations(
    state.ctx as unknown as Parameters<typeof stopAdvisorBatchConsultations>[0],
    state.records.get("batch_1") as Parameters<typeof stopAdvisorBatchConsultations>[1],
  );

  assert.equal(stopped, true);
  const events = analyticsEvents(state.scheduled);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.distinctId, "user_1");
  assert.equal(eventProperties(events[0]).status, "cancelled");
});

test("Advisor watchdog timeouts emit one terminal analytics event", async () => {
  const state = terminalAnalyticsState();
  const result = await timeoutRunHandler(state.ctx, { runId: "run_1" });

  assert.equal(result.changed, true);
  assert.equal(state.records.get("run_1")?.status, "timedOut");
  const events = analyticsEvents(state.scheduled);
  assert.equal(events.length, 1);
  assert.equal(eventProperties(events[0]).error_code, "ADVISOR_TIMEOUT");
});

test("full Advisor batch cancellation emits terminal analytics for unfinished runs", async () => {
  const state = terminalAnalyticsState();
  const cancelled = await cancelAdvisorBatchRows(
    state.ctx as unknown as Parameters<typeof cancelAdvisorBatchRows>[0],
    state.records.get("batch_1") as Parameters<typeof cancelAdvisorBatchRows>[1],
  );

  assert.equal(cancelled, true);
  assert.equal(state.records.get("run_1")?.status, "cancelled");
  assert.equal(state.records.get("run_2")?.status, "cancelled");
  assert.equal(analyticsEvents(state.scheduled).length, 2);
});

test("execution-owned Advisor cancellation uses only run-tree teardown", async (t) => {
  t.after(() => mock.restoreAll());
  const state = terminalAnalyticsState();
  const batch = state.records.get("batch_1");
  assert.ok(batch);
  Object.assign(batch, {
    executionRunId: "execution_1",
    workflowId: "workflow_parent",
    generationSnapshot: { kind: "research_paper", request: {} },
    generationOperationIds: ["workflow_child_1", "workflow_child_2"],
  });
  const cancel = mock.method(durableWorkflow, "cancel", async () => undefined);
  const status = mock.method(durableWorkflow, "status", async () => ({
    type: "inProgress" as const,
    running: [],
  }));

  await cancelAdvisorBatchRows(
    state.ctx as unknown as Parameters<typeof cancelAdvisorBatchRows>[0],
    batch as Parameters<typeof cancelAdvisorBatchRows>[1],
  );

  assert.equal(cancel.mock.callCount(), 0);
  assert.equal(status.mock.callCount(), 0);
  assert.equal(
    state.scheduled.filter((entry) => entry.runId === "execution_1").length,
    1,
  );
});

function run(id: string, personaId: string, status: string): TestRecord {
  return {
    _id: id,
    batchId: "batch_1",
    userId: "user_1",
    chatId: "chat_1",
    personaId,
    status,
    requestedModelId: "advisor-model",
    allowWebSearch: false,
    createdAt: 1,
  };
}

function analyticsEvents(events: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return events.filter((event) => event.event === "advisor_consultation_failed");
}

function eventProperties(event: Record<string, unknown> | undefined): Record<string, unknown> {
  return (event?.properties ?? {}) as Record<string, unknown>;
}
