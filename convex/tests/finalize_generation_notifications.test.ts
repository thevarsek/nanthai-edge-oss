import assert from "node:assert/strict";
import test from "node:test";

import { getFunctionName } from "convex/server";
import { internal } from "../_generated/api";
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

test("finalizeGenerationHandler schedules chat completion push only after sibling assistant messages finish", async () => {
  const scheduledCalls: Array<{ ref: string; args: Record<string, unknown> }> = [];

  const completedCtx = {
    db: {
      get: async (id: string) => {
        if (id === "job_1") {
          return { _id: id, status: "streaming" };
        }
        if (id === "chat_1") {
          return { _id: id, title: "Quarterly planning" };
        }
        if (id === "msg_1") {
          return { _id: id, status: "streaming" };
        }
        if (id === "user_msg_1") {
          return { _id: id };
        }
        return null;
      },
      patch: async () => undefined,
      insert: async () => "usage_1",
      query: (table: string) => ({
        withIndex: (_index: string, builder: any) => {
          if (table === "userPreferences") {
            builder({ eq: (_field: string, value: string) => value });
            return {
              collect: async () => [],
              first: async () => ({ chatCompletionNotificationsEnabled: true }),
            };
          }
          const status = builder({
            eq: (_field: string, _chatId: string) => ({
              eq: (_field2: string, nextStatus: string) => nextStatus,
            }),
          });
          return {
            collect: async () => {
              if (table === "messages") {
                if (status === "pending" || status === "streaming") {
                  return [];
                }
                if (status === "completed") {
                  return [{
                    _id: "msg_1",
                    role: "assistant",
                    content: "Done.",
                    parentMessageIds: ["user_msg_1"],
                  }];
                }
              }
              return [];
            },
            first: async () => null,
          };
        },
      }),
    },
    scheduler: {
      runAfter: async (_delayMs: number, fn: unknown, args: Record<string, unknown>) => {
        scheduledCalls.push({ ref: getFunctionName(fn as any), args });
      },
    },
  } as any;

  await finalizeGenerationHandler(completedCtx, {
    messageId: "msg_1" as any,
    jobId: "job_1" as any,
    chatId: "chat_1" as any,
    content: "Done.",
    status: "completed",
    userId: "user_1",
    triggerUserMessageId: "user_msg_1" as any,
  });

  assert.deepEqual(
    scheduledCalls.find((call) => call.ref === getFunctionName(internal.push.actions.sendPushNotification)),
    {
      ref: getFunctionName(internal.push.actions.sendPushNotification),
      args: {
        userId: "user_1",
        title: "Reply complete",
        body: "A new reply is ready in Quarterly planning.",
        chatId: "chat_1",
        category: "CHAT_COMPLETION",
      },
    },
  );

  const inFlightScheduledCalls: Array<{ ref: string; args: Record<string, unknown> }> = [];
  const inFlightCtx = {
    db: {
      get: async (id: string) => {
        if (id === "job_2") {
          return { _id: id, status: "streaming" };
        }
        if (id === "chat_1") {
          return { _id: id, title: "Quarterly planning" };
        }
        if (id === "msg_2") {
          return { _id: id, status: "streaming" };
        }
        if (id === "user_msg_1") {
          return { _id: id };
        }
        return null;
      },
      patch: async () => undefined,
      insert: async () => "usage_1",
      query: (table: string) => ({
        withIndex: (_index: string, builder: any) => {
          if (table === "userPreferences") {
            builder({ eq: (_field: string, value: string) => value });
            return {
              collect: async () => [],
              first: async () => ({ chatCompletionNotificationsEnabled: true }),
            };
          }
          const status = builder({
            eq: (_field: string, _chatId: string) => ({
              eq: (_field2: string, nextStatus: string) => nextStatus,
            }),
          });
          return {
            collect: async () => {
              if (table === "messages" && status === "streaming") {
                return [{
                  _id: "msg_3",
                  role: "assistant",
                  content: "",
                  parentMessageIds: ["user_msg_1"],
                }];
              }
              return [];
            },
            first: async () => null,
          };
        },
      }),
    },
    scheduler: {
      runAfter: async (_delayMs: number, fn: unknown, args: Record<string, unknown>) => {
        inFlightScheduledCalls.push({ ref: getFunctionName(fn as any), args });
      },
    },
  } as any;

  await finalizeGenerationHandler(inFlightCtx, {
    messageId: "msg_2" as any,
    jobId: "job_2" as any,
    chatId: "chat_1" as any,
    content: "Done.",
    status: "completed",
    userId: "user_1",
    triggerUserMessageId: "user_msg_1" as any,
  });

  assert.equal(
    inFlightScheduledCalls.some((call) => call.ref === getFunctionName(internal.push.actions.sendPushNotification)),
    false,
  );
});
