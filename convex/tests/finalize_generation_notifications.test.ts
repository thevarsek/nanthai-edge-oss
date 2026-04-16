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

test("finalizeGenerationHandler schedules chat completion push for video-only completions", async () => {
  const scheduledCalls: Array<{ ref: string; args: Record<string, unknown> }> = [];

  const ctx = {
    db: {
      get: async (id: string) => {
        if (id === "job_video") {
          return { _id: id, status: "streaming" };
        }
        if (id === "chat_video") {
          return { _id: id, title: "Sora test" };
        }
        if (id === "msg_video") {
          return { _id: id, status: "streaming" };
        }
        if (id === "user_msg_video") {
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
                    _id: "msg_video",
                    role: "assistant",
                    content: "",
                    videoUrls: ["https://storage.convex.cloud/video.mp4"],
                    parentMessageIds: ["user_msg_video"],
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

  await finalizeGenerationHandler(ctx, {
    messageId: "msg_video" as any,
    jobId: "job_video" as any,
    chatId: "chat_video" as any,
    content: "",
    videoUrls: ["https://storage.convex.cloud/video.mp4"],
    status: "completed",
    userId: "user_1",
    triggerUserMessageId: "user_msg_video" as any,
  });

  assert.deepEqual(
    scheduledCalls.find((call) => call.ref === getFunctionName(internal.push.actions.sendPushNotification)),
    {
      ref: getFunctionName(internal.push.actions.sendPushNotification),
      args: {
        userId: "user_1",
        title: "Reply complete",
        body: "A new reply is ready in Sora test.",
        chatId: "chat_video",
        category: "CHAT_COMPLETION",
      },
    },
  );
});

test("finalizeGenerationHandler schedules chat completion push for audio-only completions", async () => {
  const scheduledCalls: Array<{ ref: string; args: Record<string, unknown> }> = [];

  const ctx = {
    db: {
      get: async (id: string) => {
        if (id === "job_audio") {
          return { _id: id, status: "streaming" };
        }
        if (id === "chat_audio") {
          return { _id: id, title: "Voice reply" };
        }
        if (id === "msg_audio") {
          return { _id: id, status: "streaming" };
        }
        if (id === "user_msg_audio") {
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
                    _id: "msg_audio",
                    role: "assistant",
                    content: "",
                    audioStorageId: "storage_audio_1",
                    parentMessageIds: ["user_msg_audio"],
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

  await finalizeGenerationHandler(ctx, {
    messageId: "msg_audio" as any,
    jobId: "job_audio" as any,
    chatId: "chat_audio" as any,
    content: "",
    audioStorageId: "storage_audio_1" as any,
    status: "completed",
    userId: "user_1",
    triggerUserMessageId: "user_msg_audio" as any,
  });

  assert.deepEqual(
    scheduledCalls.find((call) => call.ref === getFunctionName(internal.push.actions.sendPushNotification)),
    {
      ref: getFunctionName(internal.push.actions.sendPushNotification),
      args: {
        userId: "user_1",
        title: "Reply complete",
        body: "A new reply is ready in Voice reply.",
        chatId: "chat_audio",
        category: "CHAT_COMPLETION",
      },
    },
  );
});

test("finalizeGenerationHandler schedules chat completion push for async video completion before completed query reflects the patch", async () => {
  const scheduledCalls: Array<{ ref: string; args: Record<string, unknown> }> = [];

  const ctx = {
    db: {
      get: async (id: string) => {
        if (id === "job_video_async") {
          return { _id: id, status: "streaming" };
        }
        if (id === "chat_video_async") {
          return { _id: id, title: "Async video" };
        }
        if (id === "msg_video_async") {
          return {
            _id: id,
            role: "assistant",
            status: "streaming",
            parentMessageIds: ["user_msg_video_async"],
          };
        }
        if (id === "user_msg_video_async") {
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
          builder({
            eq: (_field: string, _chatId: string) => ({
              eq: (_field2: string, _status: string) => [],
            }),
          });
          return {
            collect: async () => [],
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

  await finalizeGenerationHandler(ctx, {
    messageId: "msg_video_async" as any,
    jobId: "job_video_async" as any,
    chatId: "chat_video_async" as any,
    content: "",
    videoUrls: ["https://storage.convex.cloud/video.mp4"],
    status: "completed",
    userId: "user_1",
    triggerUserMessageId: "user_msg_video_async" as any,
  });

  assert.deepEqual(
    scheduledCalls.find((call) => call.ref === getFunctionName(internal.push.actions.sendPushNotification)),
    {
      ref: getFunctionName(internal.push.actions.sendPushNotification),
      args: {
        userId: "user_1",
        title: "Reply complete",
        body: "A new reply is ready in Async video.",
        chatId: "chat_video_async",
        category: "CHAT_COMPLETION",
      },
    },
  );
});
