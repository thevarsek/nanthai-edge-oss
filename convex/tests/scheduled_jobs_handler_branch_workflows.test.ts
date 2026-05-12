import assert from "node:assert/strict";
import test from "node:test";

import type { Id } from "../_generated/dataModel";
import {
  continueScheduledJobExecutionHandler,
  executeScheduledJobHandler,
  failScheduledJobExecutionHandler,
} from "../scheduledJobs/actions_handlers";

function activeJob(overrides: Record<string, unknown> = {}) {
  return {
    _id: "job_1" as Id<"scheduledJobs">,
    userId: "user_1",
    name: "Daily Digest",
    prompt: "Summarize updates",
    modelId: "openai/gpt-5",
    recurrence: { type: "daily", hourUTC: 8, minuteUTC: 30 },
    status: "active",
    timezone: "Europe/London",
    scheduledFunctionId: "scheduled_prev",
    consecutiveFailures: 1,
    steps: [
      { prompt: "Summarize updates", modelId: "openai/gpt-5" },
      { prompt: "Extract follow ups", modelId: "openai/gpt-5" },
    ],
    ...overrides,
  };
}

test("scheduled job handler no-ops for missing jobs and non-executable scheduled invocations", async () => {
  let mutationCount = 0;
  let scheduledCount = 0;
  await executeScheduledJobHandler({
    runQuery: async () => null,
    runMutation: async () => {
      mutationCount += 1;
    },
    scheduler: {
      runAfter: async () => {
        scheduledCount += 1;
      },
      runAt: async () => {
        scheduledCount += 1;
      },
    },
  } as any, { jobId: "missing" as Id<"scheduledJobs"> });
  assert.equal(mutationCount, 0);
  assert.equal(scheduledCount, 0);

  await executeScheduledJobHandler({
    runQuery: async () => activeJob({ status: "paused" }),
    runMutation: async () => {
      mutationCount += 1;
    },
    scheduler: {
      runAfter: async () => {
        scheduledCount += 1;
      },
      runAt: async () => {
        scheduledCount += 1;
      },
    },
  } as any, { jobId: "job_1" as Id<"scheduledJobs">, invocationSource: "scheduled" });
  assert.equal(mutationCount, 0);
  assert.equal(scheduledCount, 0);
});

test("scheduled job handler records setup failures and schedules failure notification", async () => {
  const mutationArgs: Array<Record<string, unknown>> = [];
  const scheduled: Array<Record<string, unknown>> = [];
  let mutationCount = 0;
  const ctx = {
    runQuery: async () => activeJob(),
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutationCount += 1;
      if (mutationCount === 1) throw new Error("begin failed");
      mutationArgs.push(args);
      return undefined;
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
        return "scheduled_failure";
      },
    },
  } as any;

  await executeScheduledJobHandler(ctx, {
    jobId: "job_1" as Id<"scheduledJobs">,
    invocationSource: "api",
  });

  assert.equal(mutationArgs.length, 1);
  assert.equal(mutationArgs[0].consecutiveFailures, 2);
  assert.match(String(mutationArgs[0].error), /begin failed/);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].userId, "user_1");
  assert.match(String(scheduled[0].body), /begin failed/);
});

test("continueScheduledJobExecution enqueues the next step with prior assistant content and variables", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  const scheduled: Array<Record<string, unknown>> = [];
  const job = activeJob({
    activeExecutionId: "exec_1",
    activeExecutionChatId: "chat_1",
    activeStepIndex: 0,
    activeExecutionVariables: { topic: "releases" },
    steps: [
      { prompt: "Summarize updates", modelId: "openai/gpt-5" },
      { prompt: "Extract {{topic}} follow ups", modelId: "openai/gpt-5" },
    ],
  });
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.messageId) return { _id: args.messageId, content: "Previous answer" };
      return job;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      return {
        userMessageId: "msg_user_2",
        assistantMsgId: "msg_assistant_2",
        genJobId: "gen_2",
        created: true,
      };
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
        return "scheduled_step";
      },
    },
  } as any;

  await continueScheduledJobExecutionHandler(ctx, {
    jobId: "job_1" as Id<"scheduledJobs">,
    chatId: "chat_1" as Id<"chats">,
    executionId: "exec_1",
    completedStepIndex: 0,
    assistantMessageId: "msg_assistant_1" as Id<"messages">,
  });

  assert.equal(mutations[0]?.stepIndex, 1);
  assert.match(String(mutations[0]?.content), /Previous answer/);
  assert.match(String(mutations[0]?.content), /releases/);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].userId, "user_1");
  assert.equal((scheduled[0].assistantMessageIds as string[] | undefined)?.[0], "msg_assistant_2");
});

test("continueScheduledJobExecution handles missing API keys as execution failures with chat context", async () => {
  const mutationArgs: Array<Record<string, unknown>> = [];
  const scheduled: Array<Record<string, unknown>> = [];
  const job = activeJob({
    activeExecutionId: "exec_1",
    activeExecutionChatId: "chat_1",
    activeStepIndex: 0,
    activeExecutionStartedAt: 5000,
  });
  let queryCount = 0;
  const ctx = {
    runQuery: async () => {
      queryCount += 1;
      return queryCount === 1 ? job : null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutationArgs.push(args);
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
        return "failure_push";
      },
    },
  } as any;

  await continueScheduledJobExecutionHandler(ctx, {
    jobId: "job_1" as Id<"scheduledJobs">,
    chatId: "chat_1" as Id<"chats">,
    executionId: "exec_1",
    completedStepIndex: 0,
    assistantMessageId: "msg_assistant_1" as Id<"messages">,
  });

  assert.equal(mutationArgs[0]?.startedAt, 5000);
  assert.match(String(mutationArgs[0]?.error), /No API key found/);
  assert.equal(scheduled[0]?.chatId, "chat_1");
});

test("failScheduledJobExecution ignores missing or stale execution callbacks", async () => {
  let mutationCount = 0;
  let scheduledCount = 0;
  const ctx = {
    runQuery: async () => activeJob({ activeExecutionId: "exec_current" }),
    runMutation: async () => {
      mutationCount += 1;
    },
    scheduler: {
      runAfter: async () => {
        scheduledCount += 1;
      },
    },
  } as any;

  await failScheduledJobExecutionHandler(ctx, {
    jobId: "job_1" as Id<"scheduledJobs">,
    executionId: "exec_old",
    error: "late failure",
  });

  assert.equal(mutationCount, 0);
  assert.equal(scheduledCount, 0);

  await failScheduledJobExecutionHandler({
    ...ctx,
    runQuery: async () => null,
  } as any, {
    jobId: "missing" as Id<"scheduledJobs">,
    executionId: "exec_old",
    error: "late failure",
  });
  assert.equal(mutationCount, 0);
  assert.equal(scheduledCount, 0);
});
