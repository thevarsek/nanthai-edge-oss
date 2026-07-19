import assert from "node:assert/strict";
import test from "node:test";
import { finalizeAdvisorRun, stopAdvisorBatchConsultations } from "../advisors/lifecycle";
import { completeBatchForMessage } from "../advisors/mutations_internal";
import { getChatCostSummaryHandler } from "../chat/queries_handlers_public";
import { reconcileAdvisorWork } from "../advisors/workflow_steps";

type TestRecord = Record<string, unknown>;
type FinalizeArgs = Parameters<typeof finalizeAdvisorRun>[1];
const completeBatchHandler = (completeBatchForMessage as unknown as {
  _handler: (ctx: unknown, args: { messageId: string }) => Promise<boolean>;
})._handler;

function lifecycleState() {
  const records = new Map<string, TestRecord>([
    ["batch_1", {
      _id: "batch_1",
      userId: "user_1",
      chatId: "chat_1",
      assistantMessageIds: ["assistant_1", "assistant_2"],
      status: "running",
      expectedRunCount: 2,
      completedRunCount: 0,
      failedRunCount: 0,
      generationSnapshot: {
        kind: "generation",
        args: {
          chatId: "chat_1",
          userMessageId: "user_message_1",
          assistantMessageIds: ["assistant_1", "assistant_2"],
          generationJobIds: ["job_1", "job_2"],
          participants: [{ modelId: "model", messageId: "assistant_1", jobId: "job_1" }],
          userId: "user_1",
          expandMultiModelGroups: true,
          webSearchEnabled: false,
        },
      },
      workflowId: "workflow_1",
    }],
    ["run_1", {
      _id: "run_1",
      batchId: "batch_1",
      userId: "user_1",
      chatId: "chat_1",
      personaId: "persona_1",
      status: "streaming",
      requestedModelId: "advisor-model",
      allowWebSearch: false,
      createdAt: 1,
    }],
    ["run_2", {
      _id: "run_2",
      batchId: "batch_1",
      userId: "user_1",
      chatId: "chat_1",
      personaId: "persona_2",
      status: "consulting",
      requestedModelId: "advisor-model",
      allowWebSearch: true,
      createdAt: 1,
      scheduledFunctionId: "run_2_schedule",
      watchdogScheduledFunctionId: "run_2_watchdog",
    }],
  ]);
  const scheduled: Array<{ args: Record<string, unknown> }> = [];
  const cancelled: string[] = [];
  const workflowEvents: Array<Record<string, unknown>> = [];
  const ctx = {
    db: {
      get: async (id: string) => records.get(id) ?? null,
      patch: async (id: string, patch: Record<string, unknown>) => {
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
        scheduled.push({ args });
        return `scheduled_${scheduled.length}`;
      },
      cancel: async (id: string) => {
        cancelled.push(id);
      },
    },
    runMutation: async (_reference: unknown, args: Record<string, unknown>) => {
      workflowEvents.push(args);
      return "advisor-event-1";
    },
  } as unknown as Parameters<typeof finalizeAdvisorRun>[0];
  return { ctx, records, scheduled, cancelled, workflowEvents };
}

test("parallel Advisor completion signals the durable workflow exactly once", async () => {
  const state = lifecycleState();
  const first = await finalizeAdvisorRun(state.ctx, {
    runId: "run_1" as FinalizeArgs["runId"],
    status: "completed",
    advice: "Useful advice",
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, cost: 0.01 },
  });
  assert.equal(first.allTerminal, false);
  assert.equal(state.scheduled.filter((entry) => entry.args.source === "advisor").length, 1);
  assert.equal(state.scheduled.filter((entry) => Array.isArray(entry.args.participants)).length, 0);

  const second = await finalizeAdvisorRun(state.ctx, {
    runId: "run_2" as FinalizeArgs["runId"],
    status: "failed",
    errorCode: "PROVIDER_ERROR",
    errorMessage: "Unavailable",
  });
  assert.equal(second.allTerminal, true);
  assert.equal(state.workflowEvents.length, 1);
  assert.equal(state.workflowEvents[0]?.name, "advisor-batch-terminal");
  assert.equal(state.records.get("batch_1")?.status, "synthesizing");
  assert.equal(state.records.get("batch_1")?.completedRunCount, 1);
  assert.equal(state.records.get("batch_1")?.failedRunCount, 1);

  const duplicate = await finalizeAdvisorRun(state.ctx, {
    runId: "run_2" as FinalizeArgs["runId"],
    status: "failed",
  });
  assert.equal(duplicate.changed, false);
  assert.equal(state.workflowEvents.length, 1);
});

test("pre-M47 Advisor batches retain their deferred generation drain path", async () => {
  const state = lifecycleState();
  const batch = state.records.get("batch_1");
  assert.ok(batch);
  delete batch.workflowId;
  await finalizeAdvisorRun(state.ctx, {
    runId: "run_1" as FinalizeArgs["runId"],
    status: "completed",
    advice: "Legacy first",
  });
  await finalizeAdvisorRun(state.ctx, {
    runId: "run_2" as FinalizeArgs["runId"],
    status: "completed",
    advice: "Legacy second",
  });
  assert.equal(state.workflowEvents.length, 0);
  assert.equal(
    state.scheduled.filter((entry) => Array.isArray(entry.args.participants)).length,
    1,
  );
  assert.equal(
    typeof state.records.get("batch_1")?.scheduledFinalGenerationAt,
    "number",
  );
});

test("Advisor persistence discards SDK request and private prompt dumps", async () => {
  const state = lifecycleState();
  await finalizeAdvisorRun(state.ctx, {
    runId: "run_1" as FinalizeArgs["runId"],
    status: "failed",
    errorCode: "INTERNAL_ERROR",
    errorMessage: "ChatSend failed: " + JSON.stringify({
      name: "SDKValidationError",
      cause: { name: "ZodError", message: "Invalid tool message" },
      rawValue: {
        chatRequest: { messages: [{ content: "PRIVATE_PROMPT_SENTINEL" }] },
      },
    }),
  });

  assert.equal(
    state.records.get("run_1")?.errorMessage,
    "Advisor consultation failed.",
  );
  assert.doesNotMatch(
    String(state.records.get("run_1")?.errorMessage),
    /SDKValidationError|ZodError|rawValue|chatRequest|PRIVATE_PROMPT_SENTINEL/,
  );
});

test("Advisor Workpool failure with a live lease schedules durable expiry reconciliation", async () => {
  const runAtCalls: Array<{ at: number; args: Record<string, unknown> }> = [];
  const leaseExpiresAt = Date.now() + 30_000;
  const ctx = {
    db: {
      get: async () => ({
        _id: "run_1",
        status: "streaming",
        leaseExpiresAt,
      }),
      query: () => ({ withIndex: () => ({ unique: async () => null }) }),
    },
    scheduler: {
      runAt: async (at: number, _reference: unknown, args: Record<string, unknown>) => {
        runAtCalls.push({ at, args });
        return "scheduled_1";
      },
    },
  };
  await (reconcileAdvisorWork as unknown as {
    _handler: (context: unknown, args: unknown) => Promise<void>;
  })._handler(ctx, {
    workId: "work_1",
    context: { runId: "run_1" },
    result: { kind: "failed", error: "worker stopped" },
  });
  assert.equal(runAtCalls.length, 1);
  assert.equal(runAtCalls[0]?.at, leaseExpiresAt + 1);
  assert.equal(runAtCalls[0]?.args.outcome, "failed");
});

test("Advisor barrier signals the durable workflow for every snapshot kind", async () => {
  for (const scenario of [
    {
      snapshot: {
        kind: "advanced_search",
        requests: [
          { sessionId: "search_1", assistantMessageId: "assistant_1" },
          { sessionId: "search_2", assistantMessageId: "assistant_2" },
        ],
      },
      expectedSessionIds: ["search_1", "search_2"],
    },
    {
      snapshot: {
        kind: "research_paper",
        request: { sessionId: "paper_1", assistantMessageId: "assistant_1" },
      },
      expectedSessionIds: ["paper_1"],
    },
  ]) {
    const state = lifecycleState();
    const batch = state.records.get("batch_1");
    assert.ok(batch);
    batch.generationSnapshot = scenario.snapshot;

    await finalizeAdvisorRun(state.ctx, {
      runId: "run_1" as FinalizeArgs["runId"],
      status: "completed",
      advice: "First perspective",
    });
    await finalizeAdvisorRun(state.ctx, {
      runId: "run_2" as FinalizeArgs["runId"],
      status: "completed",
      advice: "Second perspective",
    });

    assert.equal(state.workflowEvents.length, 1);
    assert.equal(state.workflowEvents[0]?.name, "advisor-batch-terminal");
  }
});

test("a terminal all-failure consultation retains cards and marks the batch failed", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const result = await completeBatchHandler({
    db: {
      get: async (id: string) => {
        if (id === "message_1") return { advisorBatchId: "batch_1" };
        if (id === "assistant_1") return { status: "failed" };
        if (id === "batch_1") {
          return {
            _id: "batch_1",
            status: "synthesizing",
            completedRunCount: 0,
            assistantMessageIds: ["assistant_1"],
          };
        }
        return null;
      },
      patch: async (id: string, patch: Record<string, unknown>) => patches.push({ id, patch }),
    },
  }, { messageId: "message_1" });
  assert.equal(result, true);
  assert.equal(patches[0]?.patch.status, "failed");
});

test("Stop Advisors preserves completed advice and schedules synthesis after cancelling unfinished runs", async () => {
  const state = lifecycleState();
  await finalizeAdvisorRun(state.ctx, {
    runId: "run_1" as FinalizeArgs["runId"],
    status: "completed",
    advice: "Preserved advice",
  });

  const stopped = await stopAdvisorBatchConsultations(
    state.ctx,
    state.records.get("batch_1") as Parameters<typeof stopAdvisorBatchConsultations>[1],
  );

  assert.equal(stopped, true);
  assert.deepEqual(state.cancelled, ["run_2_schedule", "run_2_watchdog"]);
  assert.equal(state.records.get("run_1")?.status, "completed");
  assert.equal(state.records.get("run_1")?.advice, "Preserved advice");
  assert.equal(state.records.get("run_2")?.status, "cancelled");
  assert.equal(state.records.get("batch_1")?.status, "synthesizing");
  assert.equal(state.records.get("batch_1")?.completedRunCount, 1);
  assert.equal(state.workflowEvents.length, 1);

  assert.equal(await stopAdvisorBatchConsultations(
    state.ctx,
    state.records.get("batch_1") as Parameters<typeof stopAdvisorBatchConsultations>[1],
  ), false);
});

test("a shared batch remains synthesizing until every search sibling is terminal", async () => {
  let secondStatus = "streaming";
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const ctx = {
    db: {
      get: async (id: string) => {
        if (id === "message_1" || id === "assistant_1") {
          return id === "message_1"
            ? { advisorBatchId: "batch_1" }
            : { status: "completed" };
        }
        if (id === "assistant_2") return { status: secondStatus };
        if (id === "batch_1") {
          return {
            _id: "batch_1",
            status: "synthesizing",
            completedRunCount: 2,
            assistantMessageIds: ["assistant_1", "assistant_2"],
          };
        }
        return null;
      },
      patch: async (id: string, patch: Record<string, unknown>) => patches.push({ id, patch }),
    },
  };

  assert.equal(await completeBatchHandler(ctx, { messageId: "message_1" }), false);
  assert.equal(patches.length, 0);
  secondStatus = "completed";
  assert.equal(await completeBatchHandler(ctx, { messageId: "message_1" }), true);
  assert.equal(patches[0]?.patch.status, "completed");
});

test("Advisor usage is charged once in its own chat-cost bucket", async () => {
  const summary = await getChatCostSummaryHandler({
    auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
    db: {
      get: async () => ({ _id: "chat_1", userId: "user_1" }),
      query: () => ({
        withIndex: () => ({
          collect: async () => [
            { messageId: "assistant_1", cost: 0.1 },
            { messageId: "assistant_1", cost: 0.02, source: "advisor" },
          ],
        }),
      }),
    },
  } as unknown as Parameters<typeof getChatCostSummaryHandler>[0], {
    chatId: "chat_1" as Parameters<typeof getChatCostSummaryHandler>[1]["chatId"],
  });
  assert.equal(summary?.totalCost, 0.12000000000000001);
  assert.equal(summary?.messageCosts.assistant_1, 0.1);
  assert.equal(summary?.breakdown.advisors, 0.02);
  assert.equal(summary?.breakdown.other, 0);
});
