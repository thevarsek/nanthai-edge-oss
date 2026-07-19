import assert from "node:assert/strict";
import test from "node:test";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { deleteChatGraph } from "../chat/manage_delete_helpers";
import {
  copyGeneratedMediaForMessages,
  deleteGeneratedMediaForMessage,
} from "../chat/manage_generated_media_helpers";
import { deleteGeneratedMediaKnowledgeBaseFile } from "../knowledge_base/generated_media_delete";
import { GENERATED_MEDIA_REFERENCE_TRACKING_VERSION } from "../lib/generated_media_reference_tracking";

type Row = Record<string, unknown> & { _id: string };

function lifecycleState(initial: Record<string, Row[]>) {
  const rows: Record<string, Row[]> = Object.fromEntries(
    Object.entries(initial).map(([table, values]) => [
      table,
      values.map((value) => ({ ...value })),
    ]),
  );
  const deleted: string[] = [];
  const inserted: Array<{ table: string; value: Record<string, unknown> }> = [];
  const storageDeleted: string[] = [];
  const scheduled: Array<Record<string, unknown>> = [];

  const matching = (table: string, filters: Array<[string, unknown]>): Row[] =>
    (rows[table] ?? []).filter((row) =>
      filters.every(([field, value]) => row[field] === value)
    );

  const ctx = {
    db: {
      get: async (id: string) => Object.values(rows)
        .flat()
        .find((row) => row._id === id) ?? null,
      query: (table: string) => ({
        withIndex: (
          _index: string,
          apply?: (query: {
            eq: (field: string, value: unknown) => unknown;
          }) => unknown,
        ) => {
          const filters: Array<[string, unknown]> = [];
          const query = {
            eq: (field: string, value: unknown) => {
              filters.push([field, value]);
              return query;
            },
          };
          apply?.(query);
          return {
            first: async () => matching(table, filters)[0] ?? null,
            collect: async () => matching(table, filters),
            take: async (limit: number) => matching(table, filters).slice(0, limit),
          };
        },
      }),
      insert: async (table: string, value: Record<string, unknown>) => {
        const id = `${table}_copy_${(rows[table]?.length ?? 0) + 1}`;
        rows[table] = rows[table] ?? [];
        rows[table].push({ _id: id, ...value });
        inserted.push({ table, value });
        return id;
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        const row = Object.values(rows).flat().find((candidate) => candidate._id === id);
        if (row) Object.assign(row, patch);
      },
      delete: async (id: string) => {
        deleted.push(id);
        for (const tableRows of Object.values(rows)) {
          const index = tableRows.findIndex((row) => row._id === id);
          if (index >= 0) tableRows.splice(index, 1);
        }
      },
    },
    storage: {
      getUrl: async (id: string) => `https://files.example/${id}`,
      delete: async (id: string) => {
        storageDeleted.push(id);
      },
    },
    scheduler: {
      runAfter: async (
        _delay: number,
        _functionReference: unknown,
        args: Record<string, unknown>,
      ) => {
        scheduled.push(args);
        return "scheduled_1";
      },
    },
  } as unknown as MutationCtx;

  return { rows, deleted, inserted, storageDeleted, scheduled, ctx };
}

function mediaRow(overrides: Partial<Row>): Row {
  return {
    _id: "media_1",
    _creationTime: 1,
    userId: "user_1",
    chatId: "chat_1",
    messageId: "message_1",
    storageId: "storage_shared",
    type: "image",
    mimeType: "image/png",
    referenceTrackingVersion: GENERATED_MEDIA_REFERENCE_TRACKING_VERSION,
    createdAt: 1,
    ...overrides,
  };
}

test("message deletion preserves a generated image blob used by a copied chat", async () => {
  const state = lifecycleState({
    generatedMedia: [
      mediaRow({ _id: "media_original" }),
      mediaRow({
        _id: "media_copy",
        chatId: "chat_2",
        messageId: "message_2",
      }),
    ],
  });

  await deleteGeneratedMediaForMessage(
    state.ctx,
    "message_1" as Id<"messages">,
  );
  assert.deepEqual(state.deleted, ["media_original"]);
  assert.deepEqual(state.storageDeleted, []);

  await deleteGeneratedMediaForMessage(
    state.ctx,
    "message_2" as Id<"messages">,
  );
  assert.deepEqual(state.deleted, ["media_original", "media_copy"]);
  assert.deepEqual(state.storageDeleted, ["storage_shared"]);
});

test("legacy URL-only copies retain blobs when their untracked source row is deleted", async () => {
  const state = lifecycleState({
    generatedMedia: [mediaRow({
      _id: "media_legacy_source",
      referenceTrackingVersion: undefined,
    })],
    messages: [
      { _id: "message_1", imageUrls: ["https://files.example/shared.png"] },
      { _id: "legacy_copy", imageUrls: ["https://files.example/shared.png"] },
    ],
  });

  await deleteGeneratedMediaForMessage(
    state.ctx,
    "message_1" as Id<"messages">,
  );

  assert.deepEqual(state.deleted, ["media_legacy_source"]);
  assert.deepEqual(state.storageDeleted, []);
  assert.deepEqual(state.rows.messages[1]?.imageUrls, ["https://files.example/shared.png"]);
});

test("copying legacy media never upgrades its ownership tracking state", async () => {
  const state = lifecycleState({
    generatedMedia: [mediaRow({
      _id: "media_legacy_source",
      referenceTrackingVersion: undefined,
    })],
    messages: [{
      _id: "hidden_legacy_copy",
      imageUrls: ["https://files.example/shared.png"],
    }],
  });

  await copyGeneratedMediaForMessages(
    state.ctx,
    "chat_1" as Id<"chats">,
    "chat_2" as Id<"chats">,
    new Map([["message_1", "message_new_copy"]]),
  );
  assert.equal(state.inserted[0]?.value.referenceTrackingVersion, undefined);

  await deleteGeneratedMediaForMessage(state.ctx, "message_1" as Id<"messages">);
  await deleteGeneratedMediaForMessage(state.ctx, "message_new_copy" as Id<"messages">);

  assert.deepEqual(state.storageDeleted, []);
  assert.deepEqual(
    state.rows.messages[0]?.imageUrls,
    ["https://files.example/shared.png"],
  );
});

test("Knowledge Base deletion retains legacy blobs referenced by URL-only copies", async () => {
  const sharedUrl = "https://files.example/storage_shared";
  const state = lifecycleState({
    generatedMedia: [mediaRow({
      _id: "media_legacy_source",
      referenceTrackingVersion: undefined,
    })],
    messages: [
      { _id: "message_1", imageUrls: [sharedUrl], imageMimeTypes: ["image/png"] },
      { _id: "legacy_copy", imageUrls: [sharedUrl], imageMimeTypes: ["image/png"] },
    ],
  });

  assert.equal(await deleteGeneratedMediaKnowledgeBaseFile(
    state.ctx,
    "user_1",
    "storage_shared" as Id<"_storage">,
  ), true);

  assert.deepEqual(state.rows.messages[0]?.imageUrls, []);
  assert.deepEqual(state.rows.messages[1]?.imageUrls, [sharedUrl]);
  assert.deepEqual(state.storageDeleted, []);
});

test("chat deletion drains generated media and schedules bounded continuation", async () => {
  const mediaRows = Array.from({ length: 25 }, (_, index) =>
    mediaRow({
      _id: `media_${index}`,
      messageId: `message_${index}`,
      storageId: `storage_${index}`,
      createdAt: index,
    })
  );
  const state = lifecycleState({ generatedMedia: mediaRows });

  await deleteChatGraph(state.ctx, "chat_1" as Id<"chats">);

  assert.equal(state.deleted.filter((id) => id.startsWith("media_")).length, 2);
  assert.equal(state.storageDeleted.length, 2);
  assert.deepEqual(state.scheduled, [{ chatId: "chat_1" }]);
  assert.equal(state.deleted.includes("chat_1"), false);
});

test("fork copy clones generated media ownership while sharing immutable storage", async () => {
  const state = lifecycleState({
    generatedMedia: [
      mediaRow({
        _id: "media_original",
        model: "openai/gpt-image-2",
        prompt: "Draw a lighthouse",
      }),
      mediaRow({ _id: "media_not_in_fork", messageId: "message_2" }),
    ],
  });

  await copyGeneratedMediaForMessages(
    state.ctx,
    "chat_1" as Id<"chats">,
    "chat_2" as Id<"chats">,
    new Map([["message_1", "message_copy_1"]]),
  );

  assert.equal(state.inserted.length, 1);
  assert.deepEqual(state.inserted[0], {
    table: "generatedMedia",
    value: {
      userId: "user_1",
      chatId: "chat_2",
      messageId: "message_copy_1",
      storageId: "storage_shared",
      type: "image",
      mimeType: "image/png",
      sizeBytes: undefined,
      width: undefined,
      height: undefined,
      durationSeconds: undefined,
      model: "openai/gpt-image-2",
      prompt: "Draw a lighthouse",
      referenceTrackingVersion: GENERATED_MEDIA_REFERENCE_TRACKING_VERSION,
      createdAt: 1,
    },
  });
});
