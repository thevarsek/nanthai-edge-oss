import assert from "node:assert/strict";
import test from "node:test";

import { sendMessageHandler } from "../chat/mutations_public_handlers";
import { retryMessageHandler } from "../chat/mutations_retry_handler";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal mock ctx for mutation handlers.
 *
 * @param isPro - Whether the user has Pro status in userPreferences.
 */
function buildCtx(isPro: boolean) {
  const inserts: Array<[string, Record<string, unknown>]> = [];
  const patches: Array<[string, Record<string, unknown>]> = [];

  return {
    inserts,
    patches,
    ctx: {
      auth: {
        getUserIdentity: async () => ({ subject: "user_1" }),
      },
      db: {
        get: async (id: string) => {
          if (id === "chat_1") {
            return {
              _id: "chat_1",
              userId: "user_1",
              title: "Test chat",
              messageCount: 2,
              activeBranchLeafId: "msg_assistant_1",
            };
          }
          // For retry: the original assistant message
          if (id === "msg_assistant_1") {
            return {
              _id: "msg_assistant_1",
              chatId: "chat_1",
              userId: "user_1",
              role: "assistant",
              text: "Hello",
              status: "completed",
              modelId: "openai/gpt-4o",
              participantId: "persona_abc" as any,
              participantName: "Test Persona",
              participantEmoji: "🧪",
              parentMessageIds: ["msg_user_1"],
            };
          }
          return null;
        },
        insert: async (table: string, value: Record<string, unknown>) => {
          inserts.push([table, value]);
          return `${table}_id`;
        },
        patch: async (id: string, patch: Record<string, unknown>) => {
          patches.push([id, patch]);
        },
        query: (table: string) => {
          if (table === "usageRecords") {
            return {
              withIndex: () => ({
                take: async () => [],
              }),
            };
          }
          if (table === "purchaseEntitlements") {
            return {
              withIndex: () => ({
                first: async () =>
                  isPro
                    ? { userId: "user_1", status: "active" }
                    : null,
              }),
            };
          }
          return {
            withIndex: () => ({
              first: async () => null,
              collect: async () => [],
            }),
          };
        },
      },
      scheduler: {
        runAfter: async () => "job_sched",
      },
      storage: {
        getUrl: async () => null,
      },
    } as any,
  };
}

// ---------------------------------------------------------------------------
// sendMessageHandler — persona Pro gating
// ---------------------------------------------------------------------------

test("sendMessageHandler rejects non-Pro user sending a message with persona", async () => {
  const { ctx, inserts } = buildCtx(false);

  await assert.rejects(
    sendMessageHandler(ctx, {
      chatId: "chat_1",
      text: "Hello",
      participants: [
        { modelId: "openai/gpt-4o", personaId: "persona_abc" },
      ],
    } as any),
    /Pro/,
  );

  // No messages should have been inserted
  assert.equal(inserts.length, 0);
});

test("sendMessageHandler allows non-Pro user sending a message without persona", async () => {
  const { ctx } = buildCtx(false);

  // Should not throw for the Pro check — it will proceed past the persona gate.
  // It may throw later (e.g. missing text normalization), but not with PRO_REQUIRED.
  try {
    await sendMessageHandler(ctx, {
      chatId: "chat_1",
      text: "Hello world",
      participants: [{ modelId: "openai/gpt-4o" }],
    } as any);
  } catch (e: any) {
    // Any error that is NOT PRO_REQUIRED is acceptable — the handler may fail
    // further downstream due to the minimal mock, but the persona gate passed.
    const msg = e?.data?.message ?? e?.message ?? String(e);
    assert.ok(
      !msg.includes("Pro"),
      `Expected no Pro error but got: ${msg}`,
    );
  }
});

test("sendMessageHandler allows Pro user sending a message with persona", async () => {
  const { ctx } = buildCtx(true);

  // Pro user with persona should pass the gate. May fail further downstream.
  try {
    await sendMessageHandler(ctx, {
      chatId: "chat_1",
      text: "Hello from persona",
      participants: [
        { modelId: "openai/gpt-4o", personaId: "persona_abc" },
      ],
    } as any);
  } catch (e: any) {
    const msg = e?.data?.message ?? e?.message ?? String(e);
    assert.ok(
      !msg.includes("Pro"),
      `Pro user should not hit Pro gate but got: ${msg}`,
    );
  }
});

// ---------------------------------------------------------------------------
// retryMessageHandler — persona Pro gating (explicit participants)
// ---------------------------------------------------------------------------

test("retryMessageHandler rejects non-Pro user retrying with explicit persona participant", async () => {
  const { ctx, inserts } = buildCtx(false);

  await assert.rejects(
    retryMessageHandler(ctx, {
      messageId: "msg_assistant_1",
      participants: [
        { modelId: "openai/gpt-4o", personaId: "persona_abc" },
      ],
    } as any),
    /Pro/,
  );

  // No new assistant messages should be created
  const messageInserts = inserts.filter(([table]) => table === "messages");
  assert.equal(messageInserts.length, 0);
});

// ---------------------------------------------------------------------------
// retryMessageHandler — persona Pro gating (fallback from original message)
// ---------------------------------------------------------------------------

test("retryMessageHandler rejects non-Pro user retrying when original message used a persona (fallback)", async () => {
  const { ctx } = buildCtx(false);

  // No explicit participants — handler falls back to originalMsg.participantId
  // which is "persona_abc". Should still trigger Pro gate.
  await assert.rejects(
    retryMessageHandler(ctx, {
      messageId: "msg_assistant_1",
    } as any),
    /Pro/,
  );
});

test("retryMessageHandler allows Pro user retrying with persona", async () => {
  const { ctx } = buildCtx(true);

  try {
    await retryMessageHandler(ctx, {
      messageId: "msg_assistant_1",
      participants: [
        { modelId: "openai/gpt-4o", personaId: "persona_abc" },
      ],
    } as any);
  } catch (e: any) {
    const msg = e?.data?.message ?? e?.message ?? String(e);
    assert.ok(
      !msg.includes("Pro"),
      `Pro user should not hit Pro gate but got: ${msg}`,
    );
  }
});

// ---------------------------------------------------------------------------
// retryMessageHandler — activeBranchLeafId update (ghost message fix)
// ---------------------------------------------------------------------------

test("retryMessageHandler updates activeBranchLeafId to the new assistant message", async () => {
  const { ctx, patches } = buildCtx(true);

  await retryMessageHandler(ctx, {
    messageId: "msg_assistant_1",
    participants: [
      { modelId: "openai/gpt-4o" },
    ],
  } as any);

  // The chat patch should include the new activeBranchLeafId pointing to the
  // newly created assistant message (not the old cancelled one).
  const chatPatch = patches.find(([id]) => id === "chat_1");
  assert.ok(chatPatch, "chat should have been patched");
  const [, patchData] = chatPatch;
  assert.ok(
    patchData.activeBranchLeafId !== undefined,
    "activeBranchLeafId should be set in the chat patch",
  );
  assert.ok(
    patchData.activeBranchLeafId !== "msg_assistant_1",
    "activeBranchLeafId should NOT point to the old (cancelled) message",
  );
});
