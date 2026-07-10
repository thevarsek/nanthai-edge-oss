import assert from "node:assert/strict";
import test from "node:test";
import { finalizeAdvisorRun, stopAdvisorBatchConsultations } from "../advisors/lifecycle";
import { completeBatchForMessage } from "../advisors/mutations_internal";
import { getChatCostSummaryHandler } from "../chat/queries_handlers_public";

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
  } as unknown as Parameters<typeof finalizeAdvisorRun>[0];
  return { ctx, records, scheduled, cancelled };
}

test("parallel Advisor completion schedules final generation exactly once", async () => {
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
  assert.equal(state.scheduled.filter((entry) => Array.isArray(entry.args.participants)).length, 1);
  assert.equal(state.records.get("batch_1")?.status, "synthesizing");
  assert.equal(state.records.get("batch_1")?.completedRunCount, 1);
  assert.equal(state.records.get("batch_1")?.failedRunCount, 1);

  const duplicate = await finalizeAdvisorRun(state.ctx, {
    runId: "run_2" as FinalizeArgs["runId"],
    status: "failed",
  });
  assert.equal(duplicate.changed, false);
  assert.equal(state.scheduled.filter((entry) => Array.isArray(entry.args.participants)).length, 1);
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

test("Advisor barrier resumes advanced web search and Research Paper snapshots", async () => {
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

    assert.deepEqual(
      state.scheduled.map((entry) => entry.args.sessionId),
      scenario.expectedSessionIds,
    );
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
  assert.equal(state.scheduled.filter((entry) => Array.isArray(entry.args.participants)).length, 1);

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
