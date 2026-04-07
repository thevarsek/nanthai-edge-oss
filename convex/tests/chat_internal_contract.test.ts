import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import * as chatActions from "../chat/actions";
import {
  deleteChatContinuation,
  deleteSingleChat,
} from "../chat/manage_internal";

function buildManageCtx(chat: Record<string, unknown> | null) {
  const deleted: string[] = [];
  const scheduled: Array<Record<string, unknown>> = [];

  const takeTables: Record<string, Array<Record<string, unknown>>> = {
    messages: [],
    generationJobs: [],
    autonomousSessions: [],
    usageRecords: [],
    chatParticipants: [],
    nodePositions: [],
    searchSessions: [],
    searchContexts: [],
    generatedFiles: [],
    generatedCharts: [],
    fileAttachments: [],
    subagentBatches: [],
  };

  const collectTables: Record<string, Array<Record<string, unknown>>> = {
    searchPhases: [],
    subagentRuns: [],
    messages: [],
  };

  const ctx = {
    db: {
      get: async (id: string) => (id === "chat_1" ? chat : null),
      query: (table: string) => ({
        withIndex: () => ({
          take: async () => takeTables[table] ?? [],
          collect: async () => collectTables[table] ?? [],
        }),
      }),
      delete: async (id: string) => {
        deleted.push(id);
      },
    },
    storage: {
      delete: async () => {},
    },
    scheduler: {
      runAfter: async (_delay: number, _fn: unknown, payload: Record<string, unknown>) => {
        scheduled.push(payload);
      },
    },
  } as any;

  return { ctx, deleted, scheduled };
}

test("chat actions remain registered and previewVoice enforces auth", async () => {
  assert.equal(typeof (chatActions.runGeneration as any)._handler, "function");
  assert.equal(typeof (chatActions.postProcess as any)._handler, "function");
  assert.equal(typeof (chatActions.generateTitle as any)._handler, "function");
  assert.equal(typeof (chatActions.generateAudioForMessage as any)._handler, "function");
  assert.equal(typeof (chatActions.extractMemories as any)._handler, "function");
  assert.equal(typeof (chatActions.fetchAndStoreGenerationUsage as any)._handler, "function");

  await assert.rejects(
    (chatActions.previewVoice as any)._handler(
      {
        auth: { getUserIdentity: async () => null },
      },
      { voice: "alloy" },
    ),
    (error: unknown) => {
      assert.ok(error instanceof ConvexError);
      return (error as ConvexError<any>).data?.code === "AUTH_REQUIRED";
    },
  );
});

test("deleteSingleChat deletes an owned chat graph when no children remain", async () => {
  const { ctx, deleted, scheduled } = buildManageCtx({
    _id: "chat_1",
    userId: "user_1",
  });

  await (deleteSingleChat as any)._handler(ctx, {
    chatId: "chat_1",
    userId: "user_1",
  });

  assert.deepEqual(deleted, ["chat_1"]);
  assert.deepEqual(scheduled, []);
});

test("deleteChatContinuation exits when the chat was already removed", async () => {
  const { ctx, deleted, scheduled } = buildManageCtx(null);

  await (deleteChatContinuation as any)._handler(ctx, {
    chatId: "chat_1",
  });

  assert.deepEqual(deleted, []);
  assert.deepEqual(scheduled, []);
});
