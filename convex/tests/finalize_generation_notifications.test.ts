import assert from "node:assert/strict";
import test from "node:test";

import { finalizeGenerationHandler } from "../chat/mutations_internal_handlers.ts";

test("finalizeGenerationHandler does not send completion push for manual follow-up in scheduled chat", async () => {
  const scheduledCalls: Array<Record<string, unknown>> = [];
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];

  const ctx = {
    db: {
      get: async (id: string) => {
        if (id === "job_manual_followup") {
          return {
            _id: id,
            status: "streaming",
          };
        }
        if (id === "chat_scheduled") {
          return {
            _id: id,
            sourceJobId: "scheduled_job_1",
          };
        }
        return null;
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
      insert: async () => "usage_1",
      query: () => ({
        withIndex: () => ({
          collect: async () => [],
          first: async () => null,
        }),
      }),
    },
    scheduler: {
      runAfter: async (delayMs: number, _fn: unknown, args: Record<string, unknown>) => {
        scheduledCalls.push({ delayMs, ...args });
      },
    },
  } as any;

  await finalizeGenerationHandler(ctx, {
    messageId: "msg_assistant_followup" as any,
    jobId: "job_manual_followup" as any,
    chatId: "chat_scheduled" as any,
    content: "Here is the follow-up you asked for.",
    status: "completed",
    userId: "user_1",
  });

  assert.equal(scheduledCalls.length, 0);
  assert.equal(
    patches.some((patch) => patch.id === "chat_scheduled"),
    true,
  );
});

test("finalizeGenerationHandler continues scheduled executions for scheduled-step generations", async () => {
  const scheduledCalls: Array<Record<string, unknown>> = [];

  const ctx = {
    db: {
      get: async (id: string) => {
        if (id === "job_scheduled_step") {
          return {
            _id: id,
            status: "streaming",
            sourceJobId: "scheduled_job_1",
            sourceExecutionId: "exec_1",
            sourceStepIndex: 0,
          };
        }
        if (id === "chat_scheduled") {
          return {
            _id: id,
            sourceJobId: "scheduled_job_1",
          };
        }
        return null;
      },
      patch: async () => undefined,
      insert: async () => "usage_1",
      query: () => ({
        withIndex: () => ({
          collect: async () => [],
          first: async () => null,
        }),
      }),
    },
    scheduler: {
      runAfter: async (delayMs: number, _fn: unknown, args: Record<string, unknown>) => {
        scheduledCalls.push({ delayMs, ...args });
      },
    },
  } as any;

  await finalizeGenerationHandler(ctx, {
    messageId: "msg_scheduled_assistant" as any,
    jobId: "job_scheduled_step" as any,
    chatId: "chat_scheduled" as any,
    content: "Autonomous output",
    status: "completed",
    userId: "user_1",
  });

  assert.equal(scheduledCalls.length, 1);
  assert.equal(scheduledCalls[0].jobId, "scheduled_job_1");
  assert.equal(scheduledCalls[0].executionId, "exec_1");
  assert.equal(scheduledCalls[0].completedStepIndex, 0);
});
