import assert from "node:assert/strict";
import test from "node:test";

import type { WorkflowCtx } from "@convex-dev/workflow";
import type { MutationCtx } from "../_generated/server";
import {
  GENERATION_WORKFLOW_ROUNDS_PER_CHUNK,
  nextGenerationEventOffset,
  runGenerationParticipantWorkflowHandler,
} from "../chat/generation_workflow";
import {
  startGenerationSuccessorHandler,
  type GenerationParticipantWorkflowArgs,
} from "../chat/workflow_events";
import { generationSuccessorRole } from "../chat/workflow_successor";

function workflowArgs(
  durableChain?: GenerationParticipantWorkflowArgs["durableChain"],
): GenerationParticipantWorkflowArgs {
  return {
    chatId: "chat_1" as never,
    userMessageId: "message_user" as never,
    assistantMessageIds: ["message_assistant" as never],
    generationJobIds: ["job_1" as never],
    participant: {
      modelId: "openai/gpt-5",
      messageId: "message_assistant" as never,
      jobId: "job_1" as never,
    },
    userId: "user_1",
    expandMultiModelGroups: false,
    webSearchEnabled: false,
    effectiveIntegrations: [],
    isPro: true,
    allowSubagents: true,
    resumeExpected: false,
    executionAttemptId: "attempt_1" as never,
    executionFence: 7,
    durableChain,
  };
}

test("generation Workflow chains without imposing a tool-round terminal limit", async () => {
  const eventNames: string[] = [];
  const handoffs: Array<Record<string, unknown>> = [];
  const actions: Array<Record<string, unknown>> = [];
  const roundStarts: Array<Record<string, unknown>> = [];
  let queryCallCount = 0;
  const step = {
    workflowId: "workflow_1",
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("predecessorWorkflowId" in args) {
        handoffs.push(args);
        return "workflow_2";
      }
      if ("roundKey" in args) {
        roundStarts.push(args);
        return "ready";
      }
      eventNames.push(String(args.name));
      return `event_${String(args.name)}`;
    },
    runAction: async (_ref: unknown, args: Record<string, unknown>) => {
      actions.push(args);
      return null;
    },
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("modelId" in args) return null;
      queryCallCount += 1;
      const round = Math.ceil(queryCallCount / 2);
      return queryCallCount % 2 === 0
        ? { _id: "continuation_1" }
        : {
            _id: "job_1",
            status: "streaming",
            executionAttemptId: `attempt_round_${round}`,
            executionFence: 7 + round,
          };
    },
    awaitEvent: async () => ({ mode: "checkpoint" as const }),
    runWorkflow: async () => null,
    sleep: async () => undefined,
  } as unknown as WorkflowCtx;

  await runGenerationParticipantWorkflowHandler(step, workflowArgs({
    nextEventOffset: "99999999999999999999999990",
    resumeExpected: true,
    drivePickerBatchId: "drive_1" as never,
  }));

  assert.equal(eventNames.length, GENERATION_WORKFLOW_ROUNDS_PER_CHUNK);
  assert.equal(new Set(eventNames).size, GENERATION_WORKFLOW_ROUNDS_PER_CHUNK);
  assert.equal(eventNames[0], "gen:99999999999999999999999990");
  assert.equal(roundStarts[0]?.eventOffset, "99999999999999999999999990");
  assert.equal(roundStarts.at(-1)?.eventOffset, "100000000000000000000000013");
  assert.equal(handoffs.length, 1);
  const chain = handoffs[0]?.durableChain as Record<string, unknown>;
  assert.equal(chain.nextEventOffset, "100000000000000000000000014");
  assert.equal(chain.resumeExpected, true);
  assert.equal(chain.drivePickerBatchId, "drive_1");
  assert.equal(actions[1]?.executionAttemptId, "attempt_round_1");
  assert.equal(handoffs[0]?.executionAttemptId, "attempt_round_24");
  assert.equal(handoffs[0]?.executionFence, 31);
});

test("generation Workflow creates its event before an immediate deferred completion", async () => {
  const order: string[] = [];
  let jobReads = 0;
  const step = {
    workflowId: "workflow_race",
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("roundKey" in args) return "ready";
      order.push("event-created");
      return "event_1";
    },
    runAction: async () => {
      order.push("action-signaled");
      return null;
    },
    runQuery: async () => {
      jobReads += 1;
      if (jobReads === 1) return { _id: "job_1", status: "streaming" };
      if (jobReads === 2) return { _id: "continuation_1", deferredResumeEventId: "event_1" };
      return { _id: "job_1", status: "completed" };
    },
    awaitEvent: async () => {
      order.push("event-awaited");
      return { mode: "checkpoint" as const };
    },
    runWorkflow: async () => null,
    sleep: async () => undefined,
  } as unknown as WorkflowCtx;

  await runGenerationParticipantWorkflowHandler(step, workflowArgs());
  assert.deepEqual(order.slice(0, 3), ["event-created", "action-signaled", "event-awaited"]);
  assert.equal(order.filter((item) => item === "event-created").length, 2);
});

test("successor handoff is terminal-safe and finds a delayed duplicate by exact role", async () => {
  let started = 0;
  let linked = 0;
  const componentPatches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const queriedIndexes: string[] = [];
  const unrelatedLaterComponents = Array.from({ length: 1_000 }, (_, index) => ({
    role: `later-component-${index}`,
  }));
  const args = {
    ...workflowArgs({ nextEventOffset: "24", resumeExpected: true }),
    predecessorWorkflowId: "workflow_1",
    durableChain: { nextEventOffset: "24", resumeExpected: true },
  };
  const deps = {
    startWorkflow: async () => {
      started += 1;
      return "workflow_2";
    },
    linkComponent: async () => {
      linked += 1;
      return null;
    },
  };
  const terminalCtx = {
    db: {
      get: async () => ({ _id: "job_1", status: "cancelled" }),
    },
  } as unknown as MutationCtx;
  assert.equal(await startGenerationSuccessorHandler(terminalCtx, args, deps), null);

  let getCount = 0;
  const cancellingCtx = {
    db: {
      get: async () => {
        getCount += 1;
        if (getCount === 1) {
          return {
            _id: "job_1",
            status: "streaming",
            executionRunId: "run_1",
            executionAttemptId: "attempt_1",
            executionFence: 7,
          };
        }
        if (getCount === 2) {
          return {
            _id: "run_1",
            userId: "user_1",
            activeAttemptId: "attempt_1",
            state: "cancelling",
          };
        }
        return {
          _id: "attempt_1",
          runId: "run_1",
          fence: 7,
          status: "waiting",
        };
      },
    },
  } as unknown as MutationCtx;
  assert.equal(await startGenerationSuccessorHandler(cancellingCtx, args, deps), null);

  const duplicateCtx = {
    db: {
      get: async (id: string) => {
        if (id === "run_1") {
          return {
            _id: "run_1",
            userId: "user_1",
            activeAttemptId: "attempt_1",
            state: "waiting",
          };
        }
        if (id === "attempt_1") {
          return {
            _id: "attempt_1",
            runId: "run_1",
            fence: 7,
            status: "waiting",
          };
        }
        return {
          _id: "job_1",
          status: "streaming",
          executionRunId: "run_1",
          executionAttemptId: "attempt_1",
          executionFence: 7,
        };
      },
      query: () => ({
        withIndex: (indexName: string) => ({
          unique: async () => {
            queriedIndexes.push(indexName);
            return indexName === "by_run_role"
              ? {
                  role: "generation-workflow-continuation:24:after:workflow_1",
                  operationId: "workflow_existing",
                  runId: "run_1",
                  status: "active",
                }
              : {
                  _id: "component_predecessor",
                  role: "generation-workflow",
                  operationId: "workflow_1",
                  runId: "run_1",
                  status: "active",
                };
          },
        }),
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        componentPatches.push({ id, value });
      },
    },
  } as unknown as MutationCtx;
  assert.equal(
    await startGenerationSuccessorHandler(duplicateCtx, args, deps),
    "workflow_existing",
  );
  assert.equal(started, 0);
  assert.equal(linked, 0);
  assert.equal(unrelatedLaterComponents.length, 1_000);
  assert.deepEqual(queriedIndexes.sort(), ["by_operation", "by_run_role"]);
  assert.deepEqual(componentPatches, [{
    id: "component_predecessor",
    value: {
      status: "completed",
      terminalAt: componentPatches[0]?.value.terminalAt,
      updatedAt: componentPatches[0]?.value.updatedAt,
    },
  }]);
  assert.equal(componentPatches[0]?.value.terminalAt, componentPatches[0]?.value.updatedAt);
});

test("generation event offsets increment exactly beyond JavaScript safe integers", () => {
  assert.equal(nextGenerationEventOffset("0"), "1");
  assert.equal(nextGenerationEventOffset("999999999999999999999999999"), "1000000000000000000000000000");
  assert.throws(
    () => nextGenerationEventOffset("01"),
    /GENERATION_WORKFLOW_EVENT_OFFSET_INVALID/,
  );
});

test("successor ownership is unique to its predecessor recovery epoch", () => {
  assert.notEqual(
    generationSuccessorRole("24", "workflow_primary"),
    generationSuccessorRole("24", "workflow_recovery"),
  );
});
