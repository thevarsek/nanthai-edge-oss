import assert from "node:assert/strict";
import test from "node:test";
import { execute } from "../analytics_workflows/actions";
import {
  finalizeResearchWorkflowFailure,
  runPlanningAction,
} from "../search/workflow_durable";
import { snapshotResult } from "../tools/presentation_snapshot_result";
import { settleResearchFailureDisposition } from "../search/research_failure_settlement";

const FN_NAME = Symbol.for("functionName");

function fnName(value: unknown): string {
  return (value as Record<symbol, string>)?.[FN_NAME] ?? "";
}

test("presentation snapshot replay returns the canonical persisted PPTX", async () => {
  const result = await snapshotResult({
    userId: "user_1",
    jobId: "job_1",
    ctx: {
      runQuery: async () => ({
        project: {
          _id: "project_1",
          title: "Quarterly Review",
          snapshotStorageId: "snapshot_1",
          snapshotRevision: 7,
          snapshotSizeBytes: 123,
        },
        slides: [{ _id: "slide_1" }, { _id: "slide_2" }],
      }),
      runAction: async () => assert.fail("a committed snapshot must not be exported twice"),
      runMutation: async () => assert.fail("a committed snapshot must not be recorded twice"),
      storage: {
        get: async () => new Blob([new Uint8Array(123)]),
      },
    },
  } as any, "project_1" as any, 7, "create_presentation");
  assert.equal(result.success, true);
  assert.equal((result.data as Record<string, unknown>).storageId, "snapshot_1");
  assert.equal((result.data as Record<string, unknown>).filename, "Quarterly_Review.pptx");
});

test("analytics execute replay consumes an existing envelope without rerunning user code", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  await (execute as any)._handler({
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
    },
    runQuery: async () => ({
      _id: "analytics_1",
      status: "running",
      executionEnvelopeStorageId: "envelope_1",
    }),
    storage: {
      store: async () => assert.fail("replay must not store a replacement envelope"),
    },
  }, { analyticsRunId: "analytics_1", claimantId: "claimant_1" });
  assert.deepEqual(mutations, [{
    analyticsRunId: "analytics_1",
    claimantId: "claimant_1",
    phase: "execute",
  }]);
});

test("research Workflow phase replay skips a phase already committed at its durable order", async () => {
  let mutationCount = 0;
  await (runPlanningAction as any)._handler({
    runQuery: async (ref: unknown) => {
      assert.match(fnName(ref), /getSearchPhases/);
      return [{ phaseType: "planning", phaseOrder: 0, status: "completed" }];
    },
    runMutation: async () => { mutationCount += 1; },
  }, {
    sessionId: "session_1",
    assistantMessageId: "assistant_1",
    jobId: "job_1",
    chatId: "chat_1",
    userMessageId: "user_1",
    userId: "account_1",
    query: "Research this",
    complexity: 1,
    expandMultiModelGroups: false,
    modelId: "openai/gpt-5",
    phaseOrder: 0,
    workflowManaged: true,
  });
  assert.equal(mutationCount, 0);
});

test("a retryable research phase error does not poison canonical session state", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  await assert.rejects((runPlanningAction as any)._handler({
    runQuery: async (ref: unknown) => {
      if (fnName(ref).includes("getSearchPhases")) return [];
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
    },
  }, {
    sessionId: "session_1",
    assistantMessageId: "assistant_1",
    jobId: "job_1",
    chatId: "chat_1",
    userMessageId: "user_1",
    userId: "account_1",
    query: "Research this",
    complexity: 1,
    expandMultiModelGroups: false,
    modelId: "openai/gpt-5",
    phaseOrder: 0,
    workflowManaged: true,
  }));
  assert.equal(mutations.some((args) => args.status === "failed"), false);
});

test("research failure reconciliation preserves a committed generation handoff", async () => {
  let mutationCount = 0;
  const disposition = await (finalizeResearchWorkflowFailure as any)._handler({
    runQuery: async () => ({
      status: "writing",
      generationHandoffOperationId: "generation_workflow_1",
    }),
    runMutation: async () => { mutationCount += 1; },
  }, {
    sessionId: "session_1",
    assistantMessageId: "assistant_1",
    jobId: "job_1",
    chatId: "chat_1",
    userMessageId: "user_1",
    userId: "account_1",
    query: "Research this",
    complexity: 1,
    expandMultiModelGroups: false,
    modelId: "openai/gpt-5",
    phaseOrder: 5,
    workflowManaged: true,
    error: "lost action result",
  });
  assert.equal(disposition, "handed_off");
  assert.equal(mutationCount, 0);
});

test("research cancellation outranks a committed generation handoff", async () => {
  const disposition = await (finalizeResearchWorkflowFailure as any)._handler({
    runQuery: async () => ({
      status: "cancelled",
      generationHandoffOperationId: "generation_workflow_1",
    }),
    runMutation: async () => assert.fail("terminal replay must not repeat side effects"),
  }, {
    sessionId: "session_1",
    assistantMessageId: "assistant_1",
    jobId: "job_1",
    chatId: "chat_1",
    userMessageId: "user_1",
    userId: "account_1",
    query: "Research this",
    complexity: 1,
    expandMultiModelGroups: false,
    modelId: "openai/gpt-5",
    phaseOrder: 5,
    workflowManaged: true,
    error: "cancelled",
  });
  assert.equal(disposition, "cancelled");
});

test("cancelled research failure settlement terminalizes the outer execution as cancelled", async () => {
  const mutations: Array<{ name: string; args: Record<string, unknown> }> = [];
  const settled = await settleResearchFailureDisposition({
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      mutations.push({ name: fnName(ref), args });
      return null;
    },
  } as any, {
    sessionId: "session_1" as any,
    executionAttemptId: "attempt_1" as any,
    executionFence: 7,
  }, "cancelled", "cancelled", {
    handedOff: "handoff",
    alreadyCompleted: "completed",
    cancelled: "cancelled",
  });
  assert.equal(settled, true);
  assert.match(mutations[0]?.name ?? "", /terminalizeResearchExecution/);
  assert.equal(mutations[0]?.args.outcome, "cancelled");
  assert.equal(mutations[0]?.args.executionAttemptId, "attempt_1");
  assert.equal(mutations[0]?.args.executionFence, 7);
});

test("research failure reconciliation replays the failed disposition after a lost result", async () => {
  let queryCount = 0;
  let sessionStatus = "writing";
  await (finalizeResearchWorkflowFailure as any)._handler({
      runQuery: async () => {
        queryCount += 1;
        return { status: sessionStatus };
      },
      runMutation: async (ref: unknown, args: Record<string, unknown>) => {
        if (fnName(ref).includes("updateSearchSession")) {
          sessionStatus = String((args.patch as Record<string, unknown>).status);
        }
      },
    }, {
      sessionId: "session_1",
      assistantMessageId: "assistant_1",
      jobId: "job_1",
      chatId: "chat_1",
      userMessageId: "user_1",
      userId: "account_1",
      query: "Research this",
      complexity: 1,
      expandMultiModelGroups: false,
      modelId: "openai/gpt-5",
      phaseOrder: 5,
      workflowManaged: true,
      error: "provider failed",
    });
  // Simulate the Workflow losing the action result after its side effects commit.
  assert.equal(sessionStatus, "failed");

  const replayDisposition = await (finalizeResearchWorkflowFailure as any)._handler({
    runQuery: async () => ({ status: sessionStatus }),
    runMutation: async () => assert.fail("replay must not repeat failure side effects"),
  }, {
    sessionId: "session_1",
    assistantMessageId: "assistant_1",
    jobId: "job_1",
    chatId: "chat_1",
    userMessageId: "user_1",
    userId: "account_1",
    query: "Research this",
    complexity: 1,
    expandMultiModelGroups: false,
    modelId: "openai/gpt-5",
    phaseOrder: 5,
    workflowManaged: true,
    error: "provider failed",
  });
  assert.equal(replayDisposition, "failed");
  assert.ok(queryCount > 0);
});
