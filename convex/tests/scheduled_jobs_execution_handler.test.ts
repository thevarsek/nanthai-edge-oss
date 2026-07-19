import assert from "node:assert/strict";
import test from "node:test";

import type { Id } from "../_generated/dataModel";
import {
  continueScheduledJobExecutionHandler,
  executeScheduledJobHandler,
  failScheduledJobExecutionHandler,
} from "../scheduledJobs/actions_handlers";

function activeJob() {
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
    consecutiveFailures: 0,
  };
}

test("manual invocation delegates to one durable workflow without legacy scheduling", async () => {
  const job = activeJob();
  let queryCount = 0;
  const mutationNames: string[] = [];
  const scheduledCalls: any[] = [];
  const workflowCalls: Array<Record<string, unknown>> = [];
  const ctx = {
    runQuery: async () => {
      queryCount += 1;
      if (queryCount === 1) {
        return job;
      }
      throw new Error("unexpected query");
    },
    runMutation: async (_ref: unknown, mutationArgs: Record<string, unknown>) => {
      mutationNames.push("startScheduledExecution");
      workflowCalls.push(mutationArgs);
      return "workflow_manual";
    },
    scheduler: {
      runAt: async (...args: unknown[]) => {
        scheduledCalls.push(args);
        return "scheduled_new";
      },
    },
  } as any;

  await executeScheduledJobHandler(ctx, {
    jobId: "job_1" as Id<"scheduledJobs">,
    invocationSource: "manual",
  });

  assert.deepEqual(mutationNames, ["startScheduledExecution"]);
  assert.equal(scheduledCalls.length, 0);
  assert.equal(workflowCalls.length, 1);
  assert.equal(workflowCalls[0]?.invocationSource, "manual");
  assert.match(String(workflowCalls[0]?.occurrenceId), /^manual:/);
});

test("scheduled invocation delegates overlap handling to the durable workflow", async () => {
  const job = activeJob();
  let queryCount = 0;
  const mutationNames: string[] = [];
  const scheduledCalls: any[] = [];
  const workflowCalls: Array<Record<string, unknown>> = [];
  const ctx = {
    runQuery: async () => {
      queryCount += 1;
      if (queryCount === 1) {
        return job;
      }
      throw new Error("unexpected query");
    },
    runMutation: async (_ref: unknown, mutationArgs: Record<string, unknown>) => {
      mutationNames.push("startScheduledExecution");
      workflowCalls.push(mutationArgs);
      return "workflow_scheduled";
    },
    scheduler: {
      runAt: async (...args: unknown[]) => {
        scheduledCalls.push(args);
        return "scheduled_new";
      },
    },
  } as any;

  await executeScheduledJobHandler(ctx, {
    jobId: "job_1" as Id<"scheduledJobs">,
    invocationSource: "scheduled",
  });

  assert.equal(scheduledCalls.length, 0);
  assert.deepEqual(mutationNames, ["startScheduledExecution"]);
  assert.equal(workflowCalls[0]?.invocationSource, "scheduled");
});

test("entrypoint leaves claiming and chat creation inside the workflow", async () => {
  const job = activeJob();
  let queryCount = 0;
  const mutationNames: string[] = [];
  const actionCalls: any[] = [];
  let workflowStarts = 0;
  const ctx = {
    runQuery: async () => {
      queryCount += 1;
      if (queryCount === 1) {
        return job;
      }
      if (queryCount === 2) {
        return "api-key";
      }
      throw new Error("unexpected query");
    },
    runMutation: async (_ref: unknown, _args: Record<string, unknown>) => {
      workflowStarts += 1;
      return "workflow_success";
    },
    scheduler: {
      runAt: async () => "scheduled_new",
      runAfter: async (...args: unknown[]) => {
        actionCalls.push(args);
        return "scheduled_action";
      },
    },
  } as any;

  await executeScheduledJobHandler(ctx, {
    jobId: "job_1" as Id<"scheduledJobs">,
    invocationSource: "scheduled",
  });

  assert.deepEqual(mutationNames, []);
  assert.equal(actionCalls.length, 0);
  assert.equal(workflowStarts, 1);
});

test("entrypoint delegates missing-key failure handling to the workflow", async () => {
  const job = activeJob();
  let queryCount = 0;
  const mutationNames: string[] = [];
  const actionCalls: any[] = [];
  let workflowStarts = 0;
  const ctx = {
    runQuery: async () => {
      queryCount += 1;
      if (queryCount === 1) return job;
      if (queryCount === 2) return null;
      throw new Error("unexpected query");
    },
    runMutation: async (_ref: unknown, _args: Record<string, unknown>) => {
      workflowStarts += 1;
      return "workflow_missing_key";
    },
    scheduler: {
      runAt: async () => "scheduled_new",
      runAfter: async (...args: unknown[]) => {
        actionCalls.push(args);
        return "scheduled_action";
      },
    },
  } as any;

  await executeScheduledJobHandler(ctx, {
    jobId: "job_1" as Id<"scheduledJobs">,
    invocationSource: "scheduled",
  });

  assert.deepEqual(mutationNames, []);
  assert.equal(
    actionCalls.length,
    0,
    "missing-key path does not send failure notification",
  );
  assert.equal(workflowStarts, 1);
});

test("continueScheduledJobExecutionHandler records success and sends completion notification on final step", async () => {
  const mutationNames: string[] = [];
  const pushCalls: any[] = [];
  const job = {
    ...activeJob(),
    activeExecutionId: "exec_1",
    activeExecutionChatId: "chat_1",
    activeStepIndex: 0,
    activeExecutionStartedAt: 1234,
  };

  const ctx = {
    runQuery: async () => job,
    runMutation: async (_ref: unknown, _args: Record<string, unknown>) => {
      mutationNames.push("recordRunSuccess");
      return true;
    },
    scheduler: {
      runAfter: async (...args: unknown[]) => {
        pushCalls.push(args);
        return "push_sched";
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

  assert.deepEqual(mutationNames, ["recordRunSuccess"]);
  assert.equal(pushCalls.length, 1);
  assert.equal(pushCalls[0][2].userId, "user_1");
  assert.equal(pushCalls[0][2].chatId, "chat_1");
  assert.match(pushCalls[0][2].title, /Complete/);
});

test("continueScheduledJobExecutionHandler ignores stale execution callbacks", async () => {
  let mutationCount = 0;
  let scheduledCount = 0;
  const ctx = {
    runQuery: async () => ({
      ...activeJob(),
      activeExecutionId: "exec_current",
      activeExecutionChatId: "chat_1",
      activeStepIndex: 0,
    }),
    runMutation: async () => {
      mutationCount += 1;
    },
    scheduler: {
      runAfter: async () => {
        scheduledCount += 1;
      },
    },
  } as any;

  await continueScheduledJobExecutionHandler(ctx, {
    jobId: "job_1" as Id<"scheduledJobs">,
    chatId: "chat_1" as Id<"chats">,
    executionId: "exec_old",
    completedStepIndex: 0,
    assistantMessageId: "msg_assistant_1" as Id<"messages">,
  });

  assert.equal(mutationCount, 0);
  assert.equal(scheduledCount, 0);
});

test("failScheduledJobExecutionHandler records active execution failure and notification", async () => {
  const mutationArgs: Array<Record<string, unknown>> = [];
  const pushCalls: any[] = [];
  const ctx = {
    runQuery: async () => ({
      ...activeJob(),
      activeExecutionId: "exec_1",
      activeExecutionChatId: "chat_1",
      activeExecutionStartedAt: 2222,
      consecutiveFailures: 2,
    }),
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutationArgs.push(args);
    },
    scheduler: {
      runAfter: async (...args: unknown[]) => {
        pushCalls.push(args);
        return "push_sched";
      },
    },
  } as any;

  await failScheduledJobExecutionHandler(ctx, {
    jobId: "job_1" as Id<"scheduledJobs">,
    executionId: "exec_1",
    error: "generation failed",
  });

  assert.equal(mutationArgs.length, 1);
  assert.equal(mutationArgs[0].consecutiveFailures, 3);
  assert.equal(mutationArgs[0].autoPause, true);
  assert.equal(mutationArgs[0].startedAt, 2222);
  assert.equal(pushCalls.length, 1);
  assert.equal(pushCalls[0][2].chatId, "chat_1");
  assert.match(pushCalls[0][2].body, /generation failed/);
});
