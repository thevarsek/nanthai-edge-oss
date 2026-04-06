import assert from "node:assert/strict";
import test from "node:test";

import type { Id } from "../_generated/dataModel";
import { executeScheduledJobHandler } from "../scheduledJobs/actions_handlers";

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

test("manual overlap does not replace schedule or create a chat", async () => {
  const job = activeJob();
  let queryCount = 0;
  const mutationNames: string[] = [];
  const scheduledCalls: any[] = [];

  const ctx = {
    runQuery: async () => {
      queryCount += 1;
      if (queryCount === 1) {
        return job;
      }
      throw new Error("unexpected query");
    },
    runMutation: async (_ref: unknown, _args: Record<string, unknown>) => {
      mutationNames.push("beginExecution");
      if (mutationNames.length === 1) {
        return { started: false };
      }
      throw new Error("unexpected mutation");
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

  assert.deepEqual(mutationNames, ["beginExecution"]);
  assert.equal(scheduledCalls.length, 0);
});

test("scheduled overlap reschedules next run without creating a chat", async () => {
  const job = activeJob();
  let queryCount = 0;
  const mutationNames: string[] = [];
  const scheduledCalls: any[] = [];

  const ctx = {
    runQuery: async () => {
      queryCount += 1;
      if (queryCount === 1) {
        return job;
      }
      throw new Error("unexpected query");
    },
    runMutation: async (_ref: unknown, _args: Record<string, unknown>) => {
      if (mutationNames.length === 0) {
        mutationNames.push("beginExecution");
        return { started: false };
      }
      mutationNames.push("updateNextRun");
      if (mutationNames.length === 2) {
        return undefined;
      }
      throw new Error("unexpected mutation");
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

  assert.equal(scheduledCalls.length, 1);
  assert.deepEqual(mutationNames, ["beginExecution", "updateNextRun"]);
});

test("execution is claimed before chat creation on a successful run", async () => {
  const job = activeJob();
  let queryCount = 0;
  const mutationNames: string[] = [];
  const actionCalls: any[] = [];

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
      const callIndex = mutationNames.length;
      if (callIndex === 0) {
        mutationNames.push("beginExecution");
        return { started: true };
      }
      if (callIndex === 1) {
        mutationNames.push("updateNextRun");
        return undefined;
      }
      if (callIndex === 2) {
        mutationNames.push("createJobChat");
        return "chat_1";
      }
      if (callIndex === 3) {
        mutationNames.push("createScheduledExecutionTurn");
        return {
          userMessageId: "msg_user_1",
          assistantMsgId: "msg_assistant_1",
          genJobId: "gen_1",
          created: true,
        };
      }
      throw new Error("unexpected mutation");
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

  assert.deepEqual(mutationNames, [
    "beginExecution",
    "updateNextRun",
    "createJobChat",
    "createScheduledExecutionTurn",
  ]);
  assert.equal(actionCalls.length, 1);
});
