import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import {
  createScheduledExecutionTurn,
  updateJobInternal,
} from "../scheduledJobs/mutations";

function queryChain(result: { first?: unknown }) {
  return {
    withIndex: (_index: string, apply?: (q: any) => unknown) => {
      apply?.({ eq: () => ({ eq: () => ({}) }) });
      return {
        filter: () => ({ first: async () => result.first ?? null }),
        first: async () => result.first ?? null,
      };
    },
  };
}

test("scheduled update rejects unauthorized target folders and stale execution turns", async () => {
  await assert.rejects(
    (updateJobInternal as any)._handler({
      db: {
        get: async (id: string) => id === "job_1"
          ? { _id: "job_1", userId: "user_1", prompt: "p", modelId: "m", recurrence: { type: "manual" }, status: "active" }
          : { _id: id, userId: "other" },
        query: () => queryChain({ first: { supportsTools: true } }),
      },
      scheduler: {},
    }, { jobId: "job_1", userId: "user_1", targetFolderId: "folder_bad" }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "NOT_FOUND",
  );

  await assert.rejects(
    (createScheduledExecutionTurn as any)._handler({
      db: {
        get: async () => ({ _id: "job_1", activeExecutionId: "other", activeExecutionChatId: "chat_1" }),
      },
    }, {
      jobId: "job_1",
      chatId: "chat_1",
      userId: "user_1",
      executionId: "exec_1",
      stepIndex: 0,
      stepTitle: "Step",
      content: "Run",
      modelId: "model",
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "EXECUTION_STALE",
  );
});
