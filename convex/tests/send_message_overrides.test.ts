import assert from "node:assert/strict";
import test from "node:test";

import { sendMessageHandler } from "../chat/mutations_public_handlers";
import { retryMessageHandler } from "../chat/mutations_retry_handler";
import { createAssistantMessagesAndJobs } from "../chat/mutation_send_helpers";

// =============================================================================
// Helpers
// =============================================================================

function buildMockCtx(overrides: {
  chatExists?: boolean;
  isPro?: boolean;
  existingMessages?: Record<string, unknown>[];
  originalAssistantParentMessageIds?: string[];
} = {}) {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const scheduled: Array<{ fn: unknown; args: Record<string, unknown> }> = [];

  const {
    chatExists = true,
    isPro = false,
    existingMessages = [],
    originalAssistantParentMessageIds = ["msg_user_1"],
  } = overrides;

  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "chat_1" && chatExists) {
          return { _id: "chat_1", userId: "user_1", title: "Chat", messageCount: 1 };
        }
        // For retry: original assistant message
        if (id === "msg_assist_1") {
          return {
            _id: "msg_assist_1",
            chatId: "chat_1",
            userId: "user_1",
            role: "assistant",
            content: "Hello",
            modelId: "openai/gpt-4o",
            parentMessageIds: originalAssistantParentMessageIds,
            status: "done",
          };
        }
        if (id === "msg_user_1") {
          return {
            _id: "msg_user_1",
            chatId: "chat_1",
            userId: "user_1",
            role: "user",
            content: "Hi",
          };
        }
        return null;
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return `${table}_${inserts.length}`;
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
      query: (table: string) => {
        if (table === "usageRecords") {
          return { withIndex: () => ({ take: async () => [] }) };
        }
        if (table === "purchaseEntitlements") {
          return {
            withIndex: () => ({
              first: async () => isPro ? { _id: "ent_1", userId: "user_1", status: "active" } : null,
            }),
          };
        }
        if (table === "userPreferences") {
          return { withIndex: () => ({ first: async () => ({ userId: "user_1" }) }) };
        }
        if (table === "messages") {
          return {
            withIndex: () => ({
              order: () => ({ take: async () => existingMessages }),
            }),
          };
        }
        if (table === "generationJobs") {
          return {
            withIndex: () => ({
              collect: async () => [],
            }),
          };
        }
        throw new Error(`Unexpected table query: ${table}`);
      },
    },
    scheduler: {
      runAfter: async (_delay: number, fn: unknown, args: Record<string, unknown>) => {
        scheduled.push({ fn, args });
        return "sched_1";
      },
    },
    storage: {
      getUrl: async () => null,
    },
  } as any;

  return { ctx, inserts, patches, scheduled };
}

// =============================================================================
// createAssistantMessagesAndJobs — stamps turn overrides on assistant messages
// =============================================================================

test("createAssistantMessagesAndJobs stamps turnSkillOverrides on assistant message", async () => {
  const { ctx, inserts } = buildMockCtx();
  const overrides = [{ skillId: "skill_1" as any, state: "always" as const }];

  await createAssistantMessagesAndJobs(ctx, {
    chatId: "chat_1" as any,
    userId: "user_1",
    participants: [{ modelId: "openai/gpt-4o" }],
    parentMessageIds: ["msg_1" as any],
    assistantCreatedAt: Date.now(),
    jobCreatedAt: Date.now(),
    turnSkillOverrides: overrides,
  });

  const msg = inserts.find((i) => i.table === "messages");
  assert.ok(msg);
  assert.deepEqual(msg.value.turnSkillOverrides, overrides);
  assert.equal(msg.value.turnIntegrationOverrides, undefined);
});

test("createAssistantMessagesAndJobs stamps turnIntegrationOverrides on assistant message", async () => {
  const { ctx, inserts } = buildMockCtx();
  const overrides = [{ integrationId: "gmail", enabled: true }];

  await createAssistantMessagesAndJobs(ctx, {
    chatId: "chat_1" as any,
    userId: "user_1",
    participants: [{ modelId: "openai/gpt-4o" }],
    parentMessageIds: ["msg_1" as any],
    assistantCreatedAt: Date.now(),
    jobCreatedAt: Date.now(),
    turnIntegrationOverrides: overrides,
  });

  const msg = inserts.find((i) => i.table === "messages");
  assert.ok(msg);
  assert.deepEqual(msg.value.turnIntegrationOverrides, overrides);
});

test("createAssistantMessagesAndJobs stamps both override types on all participants", async () => {
  const { ctx, inserts } = buildMockCtx();
  const skillOv = [{ skillId: "skill_1" as any, state: "never" as const }];
  const intOv = [{ integrationId: "notion", enabled: false }];

  await createAssistantMessagesAndJobs(ctx, {
    chatId: "chat_1" as any,
    userId: "user_1",
    participants: [
      { modelId: "openai/gpt-4o" },
      { modelId: "anthropic/claude-3.5-sonnet" },
    ],
    parentMessageIds: ["msg_1" as any],
    assistantCreatedAt: Date.now(),
    jobCreatedAt: Date.now(),
    turnSkillOverrides: skillOv,
    turnIntegrationOverrides: intOv,
  });

  const msgs = inserts.filter((i) => i.table === "messages");
  assert.equal(msgs.length, 2);
  for (const msg of msgs) {
    assert.deepEqual(msg.value.turnSkillOverrides, skillOv);
    assert.deepEqual(msg.value.turnIntegrationOverrides, intOv);
  }
});

test("createAssistantMessagesAndJobs seeds streaming rows and links jobs to them", async () => {
  const { ctx, inserts } = buildMockCtx();

  await createAssistantMessagesAndJobs(ctx, {
    chatId: "chat_1" as any,
    userId: "user_1",
    participants: [{ modelId: "openai/gpt-4o" }],
    parentMessageIds: ["msg_1" as any],
    assistantCreatedAt: Date.now(),
    jobCreatedAt: Date.now(),
  });

  const messageInsert = inserts.find((entry) => entry.table === "messages");
  const streamingInsert = inserts.find((entry) => entry.table === "streamingMessages");
  const jobInsert = inserts.find((entry) => entry.table === "generationJobs");

  assert.ok(messageInsert);
  assert.ok(streamingInsert);
  assert.ok(jobInsert);
  assert.equal(streamingInsert?.value.messageId, "messages_1");
  assert.equal(jobInsert?.value.messageId, "messages_1");
  assert.equal(jobInsert?.value.streamingMessageId, "streamingMessages_2");
});

test("createAssistantMessagesAndJobs omits overrides when not provided (backward compat)", async () => {
  const { ctx, inserts } = buildMockCtx();

  await createAssistantMessagesAndJobs(ctx, {
    chatId: "chat_1" as any,
    userId: "user_1",
    participants: [{ modelId: "openai/gpt-4o" }],
    parentMessageIds: ["msg_1" as any],
    assistantCreatedAt: Date.now(),
    jobCreatedAt: Date.now(),
  });

  const msg = inserts.find((i) => i.table === "messages");
  assert.ok(msg);
  assert.equal(msg.value.turnSkillOverrides, undefined);
  assert.equal(msg.value.turnIntegrationOverrides, undefined);
});

// =============================================================================
// sendMessageHandler — passes turn overrides to scheduler
// =============================================================================

test("sendMessageHandler passes turnSkillOverrides to runGeneration scheduler", async () => {
  const { ctx, scheduled } = buildMockCtx();
  const skillOv = [{ skillId: "skill_1" as any, state: "available" as const }];

  await sendMessageHandler(ctx, {
    chatId: "chat_1",
    text: "Hello",
    participants: [{ modelId: "openai/gpt-4o" }],
    turnSkillOverrides: skillOv,
  } as any);

  assert.ok(scheduled.length > 0, "Expected at least one scheduled call");
  assert.equal(scheduled[0]?.args.messageId, "messages_1");
  const genCall = scheduled.find((entry) => entry.args.assistantMessageIds);
  assert.ok(genCall);
  assert.deepEqual(genCall.args.turnSkillOverrides, skillOv);
});

test("sendMessageHandler passes turnIntegrationOverrides to runGeneration scheduler", async () => {
  const { ctx, scheduled } = buildMockCtx();
  const intOv = [{ integrationId: "gmail", enabled: true }];

  await sendMessageHandler(ctx, {
    chatId: "chat_1",
    text: "Hello",
    participants: [{ modelId: "openai/gpt-4o" }],
    turnIntegrationOverrides: intOv,
  } as any);

  assert.ok(scheduled.length > 0);
  assert.equal(scheduled[0]?.args.messageId, "messages_1");
  const genCall = scheduled.find((entry) => entry.args.assistantMessageIds);
  assert.ok(genCall);
  assert.deepEqual(genCall.args.turnIntegrationOverrides, intOv);
});

test("sendMessageHandler omits turn overrides when not provided", async () => {
  const { ctx, scheduled } = buildMockCtx();

  await sendMessageHandler(ctx, {
    chatId: "chat_1",
    text: "Hello",
    participants: [{ modelId: "openai/gpt-4o" }],
  } as any);

  assert.ok(scheduled.length > 0);
  assert.equal(scheduled[0]?.args.messageId, "messages_1");
  const genCall = scheduled.find((entry) => entry.args.assistantMessageIds);
  assert.ok(genCall);
  assert.equal(genCall.args.turnSkillOverrides, undefined);
  assert.equal(genCall.args.turnIntegrationOverrides, undefined);
});

// =============================================================================
// sendMessageHandler — stamps turn overrides on assistant message record
// =============================================================================

test("sendMessageHandler stamps turnSkillOverrides on assistant message insert", async () => {
  const { ctx, inserts } = buildMockCtx();
  const skillOv = [{ skillId: "skill_1" as any, state: "always" as const }];

  await sendMessageHandler(ctx, {
    chatId: "chat_1",
    text: "Hello",
    participants: [{ modelId: "openai/gpt-4o" }],
    turnSkillOverrides: skillOv,
  } as any);

  const assistantMsg = inserts.find(
    (i) => i.table === "messages" && i.value.role === "assistant",
  );
  assert.ok(assistantMsg);
  assert.deepEqual(assistantMsg.value.turnSkillOverrides, skillOv);
});

// =============================================================================
// retryMessageHandler — passes turn overrides to scheduler
// =============================================================================

test("retryMessageHandler passes turnSkillOverrides to runGeneration scheduler", async () => {
  const { ctx, scheduled } = buildMockCtx();
  const skillOv = [{ skillId: "skill_1" as any, state: "never" as const }];

  await retryMessageHandler(ctx, {
    messageId: "msg_assist_1",
    turnSkillOverrides: skillOv,
  } as any);

  assert.ok(scheduled.length > 0);
  assert.equal(scheduled[0]?.args.messageId, "msg_user_1");
  const genCall = scheduled.find((s) => s.args.assistantMessageIds);
  assert.ok(genCall);
  assert.deepEqual(genCall.args.turnSkillOverrides, skillOv);
});

test("retryMessageHandler passes turnIntegrationOverrides to runGeneration scheduler", async () => {
  const { ctx, scheduled } = buildMockCtx();
  const intOv = [{ integrationId: "drive", enabled: false }];

  await retryMessageHandler(ctx, {
    messageId: "msg_assist_1",
    turnIntegrationOverrides: intOv,
  } as any);

  assert.ok(scheduled.length > 0);
  assert.equal(scheduled[0]?.args.messageId, "msg_user_1");
  const genCall = scheduled.find((s) => s.args.assistantMessageIds);
  assert.ok(genCall);
  assert.deepEqual(genCall.args.turnIntegrationOverrides, intOv);
});

test("retryMessageHandler omits turn overrides when not provided", async () => {
  const { ctx, scheduled } = buildMockCtx();

  await retryMessageHandler(ctx, {
    messageId: "msg_assist_1",
  } as any);

  assert.ok(scheduled.length > 0);
  assert.equal(scheduled[0]?.args.messageId, "msg_user_1");
  const genCall = scheduled.find((s) => s.args.assistantMessageIds);
  assert.ok(genCall);
  assert.equal(genCall.args.turnSkillOverrides, undefined);
  assert.equal(genCall.args.turnIntegrationOverrides, undefined);
});

// =============================================================================
// retryMessageHandler — stamps turn overrides on assistant message record
// =============================================================================

test("retryMessageHandler stamps turn overrides on new assistant message", async () => {
  const { ctx, inserts } = buildMockCtx();
  const skillOv = [{ skillId: "skill_1" as any, state: "available" as const }];
  const intOv = [{ integrationId: "gmail", enabled: true }];

  await retryMessageHandler(ctx, {
    messageId: "msg_assist_1",
    turnSkillOverrides: skillOv,
    turnIntegrationOverrides: intOv,
  } as any);

  const assistantMsg = inserts.find(
    (i) => i.table === "messages" && i.value.role === "assistant",
  );
  assert.ok(assistantMsg);
  assert.deepEqual(assistantMsg.value.turnSkillOverrides, skillOv);
  assert.deepEqual(assistantMsg.value.turnIntegrationOverrides, intOv);
});

test("retryMessageHandler rejects assistant messages without a source user message", async () => {
  const { ctx } = buildMockCtx({ originalAssistantParentMessageIds: [] });

  await assert.rejects(
    () => retryMessageHandler(ctx, { messageId: "msg_assist_1" } as any),
    /source user message/,
  );
});
