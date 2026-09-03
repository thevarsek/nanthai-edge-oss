import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import {
  bulkMoveChatsHandler,
  deleteMessageHandler,
  reorderPinnedChatsHandler,
  updateChatHandler,
} from "../chat/manage_handlers";

function buildCtx(rows: Record<string, Record<string, unknown>> = {}) {
  const records = new Map(Object.entries(rows));
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const deletes: string[] = [];
  const storageDeletes: string[] = [];
  const tableRows: Record<string, Record<string, unknown>[]> = {
    documents: Object.values(rows).filter((row) => row._table === "documents"),
    chatParticipants: Object.values(rows).filter((row) => row._table === "chatParticipants"),
    fileAttachments: Object.values(rows).filter((row) => row._table === "fileAttachments"),
    generatedFiles: Object.values(rows).filter((row) => row._table === "generatedFiles"),
    generatedMedia: Object.values(rows).filter((row) => row._table === "generatedMedia"),
    messages: Object.values(rows).filter((row) => row._table === "messages"),
    presentationAssets: Object.values(rows).filter((row) => row._table === "presentationAssets"),
    generatedCharts: Object.values(rows).filter((row) => row._table === "generatedCharts"),
    searchContexts: Object.values(rows).filter((row) => row._table === "searchContexts"),
    searchSessions: Object.values(rows).filter((row) => row._table === "searchSessions"),
    searchPhases: Object.values(rows).filter((row) => row._table === "searchPhases"),
    generationJobs: Object.values(rows).filter((row) => row._table === "generationJobs"),
    streamingMessages: Object.values(rows).filter((row) => row._table === "streamingMessages"),
    purchaseEntitlements: Object.values(rows).filter((row) => row._table === "purchaseEntitlements"),
  };
  const queryRows = (table: string, filters: Array<[string, unknown]>) =>
    (tableRows[table] ?? []).filter((row) =>
      filters.every(([field, value]) => row[field] === value)
    );
  return {
    patches,
    deletes,
    storageDeletes,
    ctx: {
      auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
      db: {
        get: async (id: string) => records.get(id) ?? null,
        patch: async (id: string, patch: Record<string, unknown>) => {
          patches.push({ id, patch });
          records.set(id, { ...(records.get(id) ?? { _id: id }), ...patch });
        },
        delete: async (id: string) => {
          deletes.push(id);
          records.delete(id);
          for (const values of Object.values(tableRows)) {
            const index = values.findIndex((row) => row._id === id);
            if (index >= 0) values.splice(index, 1);
          }
        },
        query: (table: string) => ({
          withIndex: (_index: string, apply?: (q: any) => unknown) => {
            const filters: Array<[string, unknown]> = [];
            const q = {
              eq: (field: string, value: unknown) => {
                filters.push([field, value]);
                return q;
              },
            };
            apply?.(q);
            return {
              first: async () => queryRows(table, filters)[0] ?? null,
              collect: async () => queryRows(table, filters),
              take: async (limit: number) => queryRows(table, filters).slice(0, limit),
              unique: async () => queryRows(table, filters)[0] ?? null,
            };
          },
        }),
      },
      storage: {
        delete: async (storageId: string) => {
          storageDeletes.push(storageId);
          if (storageId === "missing_blob") throw new Error("already gone");
        },
      },
      scheduler: { runAfter: async () => "scheduled_1" },
    } as any,
  };
}

test("updateChatHandler syncs folder-only moves to owned generated documents without bumping chat recency", async () => {
  const state = buildCtx({
    chat_1: { _id: "chat_1", userId: "user_1", title: "Research" },
    folder_1: { _id: "folder_1", userId: "user_1" },
    doc_1: { _id: "doc_1", _table: "documents", userId: "user_1", originChatId: "chat_1" },
    doc_2: { _id: "doc_2", _table: "documents", userId: "other", originChatId: "chat_1" },
  });

  await updateChatHandler(state.ctx, { chatId: "chat_1" as any, folderId: "folder_1" });

  const chatPatch = state.patches.find((entry) => entry.id === "chat_1")?.patch;
  assert.equal(chatPatch?.folderId, "folder_1");
  assert.equal(chatPatch?.updatedAt, undefined);
  assert.equal(state.patches.some((entry) => entry.id === "doc_1" && entry.patch.folderId === "folder_1"), true);
  assert.equal(state.patches.some((entry) => entry.id === "doc_2"), false);
});

test("updateChatHandler requires Pro and allows chat-wide subagents with multiple participants", async () => {
  await assert.rejects(
    updateChatHandler(buildCtx({
      chat_1: { _id: "chat_1", userId: "user_1", title: "Research" },
    }).ctx, { chatId: "chat_1" as any, subagentOverride: "enabled" }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "PRO_REQUIRED",
  );

  const state = buildCtx({
      chat_1: { _id: "chat_1", userId: "user_1", title: "Research" },
      ent_1: { _id: "ent_1", _table: "purchaseEntitlements", userId: "user_1", status: "active" },
      p_1: { _id: "p_1", _table: "chatParticipants", chatId: "chat_1" },
      p_2: { _id: "p_2", _table: "chatParticipants", chatId: "chat_1" },
  });
  await updateChatHandler(
    state.ctx,
    { chatId: "chat_1" as any, subagentOverride: "enabled" },
  );
  assert.equal(
    state.patches.find((entry) => entry.id === "chat_1")?.patch.subagentOverride,
    "enabled",
  );
});

test("deleteMessageHandler removes generated artifacts, search state, jobs, and tolerates missing storage blobs", async () => {
  const state = buildCtx({
    chat_1: { _id: "chat_1", userId: "user_1" },
    msg_1: { _id: "msg_1", chatId: "chat_1", audioStorageId: "audio_1" },
    file_1: { _id: "file_1", _table: "generatedFiles", messageId: "msg_1", storageId: "missing_blob" },
    chart_1: { _id: "chart_1", _table: "generatedCharts", messageId: "msg_1" },
    context_1: { _id: "context_1", _table: "searchContexts", messageId: "msg_1" },
    session_1: { _id: "session_1", _table: "searchSessions", assistantMessageId: "msg_1" },
    phase_1: { _id: "phase_1", _table: "searchPhases", sessionId: "session_1" },
    job_1: { _id: "job_1", _table: "generationJobs", messageId: "msg_1" },
    stream_1: { _id: "stream_1", _table: "streamingMessages", messageId: "msg_1" },
  });

  await deleteMessageHandler(state.ctx, { messageId: "msg_1" as any });

  assert.ok(state.storageDeletes.includes("missing_blob"));
  assert.deepEqual(state.deletes.sort(), [
    "chart_1",
    "context_1",
    "file_1",
    "job_1",
    "msg_1",
    "phase_1",
    "session_1",
    "stream_1",
  ]);
});

test("deleteMessageHandler preserves generated audio reused by another message", async () => {
  const state = buildCtx({
    chat_1: { _id: "chat_1", userId: "user_1" },
    msg_1: { _id: "msg_1", _table: "messages", chatId: "chat_1" },
    msg_2: {
      _id: "msg_2",
      _table: "messages",
      chatId: "chat_1",
      audioStorageId: "shared_audio",
    },
    file_1: {
      _id: "file_1",
      _table: "generatedFiles",
      messageId: "msg_1",
      storageId: "shared_audio",
    },
  });

  await deleteMessageHandler(state.ctx, { messageId: "msg_1" as any });

  assert.ok(state.deletes.includes("file_1"));
  assert.equal(state.storageDeletes.includes("shared_audio"), false);
});

test("bulk move and pinned reorder skip foreign rows and reject invalid pinned lists", async () => {
  const moved = buildCtx({
    chat_1: { _id: "chat_1", userId: "user_1" },
    chat_2: { _id: "chat_2", userId: "other" },
  });
  await bulkMoveChatsHandler(moved.ctx, { chatIds: ["chat_1", "chat_2"] as any, folderId: "" });
  assert.deepEqual(moved.patches, [{ id: "chat_1", patch: { folderId: undefined } }]);

  await assert.rejects(
    reorderPinnedChatsHandler(buildCtx({
      chat_1: { _id: "chat_1", userId: "user_1", isPinned: true },
      chat_2: { _id: "chat_2", userId: "user_1", isPinned: false },
    }).ctx, { orderedChatIds: ["chat_1", "chat_2"] as any }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "VALIDATION",
  );
});
