import assert from "node:assert/strict";
import test from "node:test";

import {
  beginGenerationRoundHandler,
  transitionGenerationRoundHandler,
} from "../chat/generation_round_journal";
import {
  decideGenerationRecovery,
  recoveryNextEventOffset,
} from "../chat/workflow_completion";
import { reconcileGenerationWorkflowCompletionHandler } from "../chat/workflow_completion";

type MockIndexQuery = {
  eq: (field: string, value: unknown) => MockIndexQuery;
};

function roundDb() {
  const rows: Array<Record<string, unknown>> = [];
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const job = {
    _id: "job_1",
    chatId: "chat_1",
    userId: "user_1",
    status: "streaming",
    executionAttemptId: "attempt_1",
    executionFence: 3,
  };
  const db = {
    get: async (id: string) => id === "job_1" ? job : null,
    query: () => ({
      withIndex: () => ({
        unique: async () => rows.find((row) => row.roundKey === "event_1") ?? null,
      }),
    }),
    insert: async (_table: string, value: Record<string, unknown>) => {
      rows.push({ _id: "round_1", ...value });
      return "round_1";
    },
    patch: async (id: string, value: Record<string, unknown>) => {
      patches.push({ id, value });
      const row = rows.find((candidate) => candidate._id === id);
      if (row) Object.assign(row, value);
    },
  };
  return { db, rows, patches };
}

test("hard failure after provider dispatch is outcome-unknown and cannot replay a stale checkpoint", async () => {
  const state = roundDb();
  const identity = {
    jobId: "job_1" as any,
    userId: "user_1",
    roundKey: "event_1",
    workflowId: "workflow_1",
    executionAttemptId: "attempt_1" as any,
    executionFence: 3,
  };

  assert.equal(
    await beginGenerationRoundHandler({ db: state.db } as any, identity),
    "ready",
  );
  assert.equal(
    await transitionGenerationRoundHandler({ db: state.db } as any, {
      ...identity,
      phase: "dispatched",
    }),
    true,
  );
  assert.equal(
    await transitionGenerationRoundHandler({ db: state.db } as any, {
      ...identity,
      phase: "dispatched",
    }),
    true,
    "multiple provider transports in one action keep the same round dispatched",
  );

  const phase = state.rows[0]?.phase as "dispatched";
  assert.equal(phase, "dispatched");
  assert.equal(decideGenerationRecovery(phase, true), "fail_outcome_unknown");
  assert.notEqual(decideGenerationRecovery(phase, true), "recover_checkpoint");
});

test("recovery is allowed only before dispatch or from a committed checkpoint", () => {
  assert.equal(decideGenerationRecovery("pre_dispatch", false), "recover_pre_dispatch");
  assert.equal(decideGenerationRecovery("committed", true), "recover_checkpoint");
  assert.equal(decideGenerationRecovery("committed", false), "fail_without_checkpoint");
  assert.equal(decideGenerationRecovery(undefined, true), "fail_outcome_unknown");
  assert.equal(decideGenerationRecovery(undefined, false), "fail_outcome_unknown");
  assert.equal(decideGenerationRecovery(undefined, true, 1), "recover_pre_dispatch");
  assert.equal(decideGenerationRecovery(undefined, false, 1), "recover_pre_dispatch");
});

test("recovery continues after its latest owned event offset", () => {
  assert.equal(recoveryNextEventOffset("47", "24"), "48");
  assert.equal(recoveryNextEventOffset(undefined, "999"), "999");
  assert.equal(recoveryNextEventOffset(undefined, undefined), "0");
});

test("Workflow callback terminalizes an ambiguous dispatched round instead of starting recovery", async () => {
  const journal = {
    _id: "round_1",
    jobId: "job_1",
    userId: "user_1",
    workflowId: "workflow_1",
    phase: "dispatched",
    updatedAt: 1,
  };
  const foreignJournal = {
    _id: "round_2",
    jobId: "job_1",
    userId: "user_1",
    workflowId: "workflow_2",
    phase: "pre_dispatch",
    updatedAt: 2,
  };
  const journals = [journal, foreignJournal];
  const failures: string[] = [];
  let recoveryStarts = 0;
  const ctx = {
    db: {
      get: async (id: string) => id === "job_1"
        ? {
          _id: "job_1",
          messageId: "assistant_1",
          chatId: "chat_1",
          userId: "user_1",
          status: "streaming",
          executionRunId: "run_1",
          executionAttemptId: "attempt_1",
          executionFence: 3,
        }
        : id === "chat_1" ? { _id: "chat_1", isDeleting: false } : null,
      query: (table: string) => ({
        withIndex: (_index: string, apply: (query: MockIndexQuery) => unknown) => table === "generationRoundJournal"
          ? (() => {
            const filters: Record<string, unknown> = {};
            const query = {
              eq: (field: string, value: unknown) => {
                filters[field] = value;
                return query;
              },
            };
            apply(query);
            const matches = journals
              .filter((candidate) => Object.entries(filters).every(
                ([field, value]) => candidate[field as keyof typeof candidate] === value,
              ))
              .sort((left, right) => right.updatedAt - left.updatedAt);
            return { order: () => ({ first: async () => matches[0] ?? null }) };
          })()
          : table === "generationContinuations"
            ? { first: async () => ({ _id: "continuation_1" }) }
            : {
              unique: async () => ({
                _id: "component_1",
                status: "active",
                operationId: "workflow_1",
              }),
            },
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        if (id === journal._id) Object.assign(journal, value);
      },
      insert: async () => {
        throw new Error("ambiguous round must not register a recovery component");
      },
    },
    scheduler: {
      runAfter: async () => "cleanup_1",
    },
  } as any;

  await reconcileGenerationWorkflowCompletionHandler(ctx, {
    workflowId: "workflow_1",
    result: { kind: "failed", error: "hard action failure" },
    context: {
      participantArgs: {
        chatId: "chat_1" as any,
        userMessageId: "user_1" as any,
        assistantMessageIds: ["assistant_1" as any],
        generationJobIds: ["job_1" as any],
        participant: {
          modelId: "openai/gpt-5",
          messageId: "assistant_1" as any,
          jobId: "job_1" as any,
        },
        userId: "user_1",
        expandMultiModelGroups: false,
        webSearchEnabled: false,
        effectiveIntegrations: [],
        isPro: true,
        allowSubagents: false,
        executionAttemptId: "attempt_1" as any,
        executionFence: 3,
      },
    },
  }, {
    startWorkflow: async () => {
      recoveryStarts += 1;
      return "recovery_workflow";
    },
    interruptAttempt: async () => ({ changed: true, outcome: "interrupted" as const }),
    failGeneration: async (_ctx, _args, summary) => {
      failures.push(summary);
    },
  });

  assert.equal(recoveryStarts, 0);
  assert.equal(journal.phase, "outcome_unknown");
  assert.equal(foreignJournal.phase, "pre_dispatch");
  assert.match(failures[0] ?? "", /not retried/);
});

test("canceled generation Workflows are acknowledged without starting recovery", async () => {
  let recoveryStarts = 0;
  let interruptedAttempts = 0;
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const ctx = {
    db: {
      get: async (id: string) => id === "job_1"
        ? {
          _id: "job_1",
          status: "streaming",
          executionRunId: "run_1",
          executionAttemptId: "attempt_1",
          executionFence: 3,
        }
        : null,
      query: () => ({
        withIndex: () => ({
          unique: async () => ({
            _id: "component_1",
            status: "active",
            operationId: "workflow_1",
          }),
        }),
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
    scheduler: { runAfter: async () => "cleanup_1" },
  } as any;

  await reconcileGenerationWorkflowCompletionHandler(ctx, {
    workflowId: "workflow_1",
    result: { kind: "canceled" },
    context: {
      participantArgs: {
        chatId: "chat_1" as any,
        userMessageId: "user_message_1" as any,
        assistantMessageIds: ["assistant_1" as any],
        generationJobIds: ["job_1" as any],
        participant: {
          modelId: "openai/gpt-5",
          messageId: "assistant_1" as any,
          jobId: "job_1" as any,
        },
        userId: "user_1",
        expandMultiModelGroups: false,
        webSearchEnabled: false,
        effectiveIntegrations: [],
        isPro: true,
        allowSubagents: false,
      },
    },
  }, {
    startWorkflow: async () => {
      recoveryStarts += 1;
      return "unexpected_recovery";
    },
    interruptAttempt: async () => {
      interruptedAttempts += 1;
      return { changed: true, outcome: "interrupted" as const };
    },
    failGeneration: async () => undefined,
  });

  assert.equal(recoveryStarts, 0);
  assert.equal(interruptedAttempts, 0);
  assert.equal(patches[0]?.value.status, "cancel_requested");
  assert.equal(typeof patches[0]?.value.cancelAcknowledgedAt, "number");
});

test("failed generation Workflow completion settles quietly while its chat is deleting", async () => {
  let recoveryStarts = 0;
  let interruptedAttempts = 0;
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const ctx = {
    db: {
      get: async (id: string) => {
        if (id === "job_1") {
          return {
            _id: "job_1",
            chatId: "chat_1",
            status: "streaming",
            executionRunId: "run_1",
            executionAttemptId: "attempt_1",
            executionFence: 3,
          };
        }
        if (id === "chat_1") return { _id: "chat_1", isDeleting: true };
        return null;
      },
      query: () => ({
        withIndex: () => ({
          unique: async () => ({
            _id: "component_1",
            status: "active",
            operationId: "workflow_1",
          }),
        }),
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
    scheduler: { runAfter: async () => "cleanup_1" },
  } as any;

  await reconcileGenerationWorkflowCompletionHandler(ctx, {
    workflowId: "workflow_1",
    result: { kind: "failed", error: "stopped by chat deletion" },
    context: {
      participantArgs: {
        chatId: "chat_1" as any,
        userMessageId: "user_message_1" as any,
        assistantMessageIds: ["assistant_1" as any],
        generationJobIds: ["job_1" as any],
        participant: {
          modelId: "openai/gpt-5",
          messageId: "assistant_1" as any,
          jobId: "job_1" as any,
        },
        userId: "user_1",
        expandMultiModelGroups: false,
        webSearchEnabled: false,
        effectiveIntegrations: [],
        isPro: true,
        allowSubagents: false,
      },
    },
  }, {
    startWorkflow: async () => {
      recoveryStarts += 1;
      return "unexpected_recovery";
    },
    interruptAttempt: async () => {
      interruptedAttempts += 1;
      return { changed: true, outcome: "interrupted" as const };
    },
    failGeneration: async () => undefined,
  });

  assert.equal(recoveryStarts, 0);
  assert.equal(interruptedAttempts, 0);
  assert.equal(patches[0]?.value.status, "failed");
});
