import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";

import {
  addParticipant,
  removeParticipant,
  setParticipants,
  updateParticipant,
} from "../participants/mutations";

type Row = Record<string, any>;

function buildCtx(options?: {
  records?: Record<string, Row>;
  tableRows?: Record<string, Row[]>;
  userId?: string | null;
}) {
  const records = new Map(Object.entries(options?.records ?? {}));
  const tableRows = new Map(Object.entries(options?.tableRows ?? {}));
  const inserts: Array<{ table: string; value: Row; id: string }> = [];
  const patches: Array<{ id: string; value: Row }> = [];
  const deletes: string[] = [];
  const rowsFor = (table: string) => tableRows.get(table) ?? [];

  const ctx = {
    auth: {
      getUserIdentity: async () =>
        options?.userId === null ? null : { subject: options?.userId ?? "user_1" },
    },
    db: {
      get: async (id: string) => records.get(id) ?? null,
      insert: async (table: string, value: Row) => {
        const id = `${table}_${inserts.length + 1}`;
        const row = { _id: id, ...value };
        inserts.push({ table, value, id });
        records.set(id, row);
        tableRows.set(table, [...rowsFor(table), row]);
        return id;
      },
      patch: async (id: string, value: Row) => {
        patches.push({ id, value });
        records.set(id, { ...(records.get(id) ?? { _id: id }), ...value });
      },
      delete: async (id: string) => {
        deletes.push(id);
        records.delete(id);
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
            collect: async () => rowsFor(table).filter((row) =>
              filters.every(([field, value]) => row[field] === value),
            ),
          };
        },
      }),
    },
  } as any;

  return { ctx, records, tableRows, inserts, patches, deletes };
}

test("participant mutations enforce auth, ownership, active autonomous locks, and cardinality", async () => {
  await assert.rejects(
    (addParticipant as any)._handler(buildCtx({ userId: null }).ctx, {
      chatId: "chat_1",
      modelId: "model_1",
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "AUTH_REQUIRED",
  );

  await assert.rejects(
    (addParticipant as any)._handler(buildCtx().ctx, { chatId: "missing", modelId: "model_1" }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "NOT_FOUND",
  );

  await assert.rejects(
    (addParticipant as any)._handler(buildCtx({
      records: { chat_1: { _id: "chat_1", userId: "user_1" } },
      tableRows: { autonomousSessions: [{ _id: "session_1", chatId: "chat_1", status: "paused" }] },
    }).ctx, { chatId: "chat_1", modelId: "model_1" }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "VALIDATION",
  );

  await assert.rejects(
    (addParticipant as any)._handler(buildCtx({
      records: { chat_1: { _id: "chat_1", userId: "user_1" } },
      tableRows: {
        autonomousSessions: [],
        chatParticipants: [
          { _id: "p1", chatId: "chat_1", sortOrder: 0 },
          { _id: "p2", chatId: "chat_1", sortOrder: 1 },
          { _id: "p3", chatId: "chat_1", sortOrder: 2 },
        ],
      },
    }).ctx, { chatId: "chat_1", modelId: "model_4" }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "VALIDATION",
  );
});

test("addParticipant chooses sort order and clears enabled subagent override for multimodel chats", async () => {
  const state = buildCtx({
    records: { chat_1: { _id: "chat_1", userId: "user_1", subagentOverride: "enabled" } },
    tableRows: {
      autonomousSessions: [{ _id: "done", chatId: "chat_1", status: "completed" }],
      chatParticipants: [{ _id: "p1", chatId: "chat_1", sortOrder: 3 }],
    },
  });

  const id = await (addParticipant as any)._handler(state.ctx, {
    chatId: "chat_1",
    modelId: "model_2",
    personaEmoji: null,
    personaAvatarImageUrl: null,
  });

  assert.equal(id, "chatParticipants_1");
  assert.equal(state.inserts[0].value.sortOrder, 4);
  assert.equal(state.inserts[0].value.personaEmoji, undefined);
  assert.equal(state.patches.find((entry) => entry.id === "chat_1")?.value.subagentOverride, undefined);
});

test("removeParticipant protects last participant and reorders remaining siblings", async () => {
  await assert.rejects(
    (removeParticipant as any)._handler(buildCtx({
      records: { p1: { _id: "p1", userId: "user_1", chatId: "chat_1" } },
      tableRows: {
        autonomousSessions: [],
        chatParticipants: [{ _id: "p1", chatId: "chat_1", sortOrder: 0 }],
      },
    }).ctx, { participantId: "p1" }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "VALIDATION",
  );

  const state = buildCtx({
    records: {
      chat_1: { _id: "chat_1", userId: "user_1" },
      p1: { _id: "p1", userId: "user_1", chatId: "chat_1" },
    },
    tableRows: {
      autonomousSessions: [],
      chatParticipants: [
        { _id: "p1", chatId: "chat_1", sortOrder: 0 },
        { _id: "p2", chatId: "chat_1", sortOrder: 2 },
      ],
    },
  });

  await (removeParticipant as any)._handler(state.ctx, { participantId: "p1" });

  assert.deepEqual(state.deletes, ["p1"]);
  assert.ok(state.patches.some((entry) => entry.id === "p2" && entry.value.sortOrder === 0));
  assert.ok(state.patches.some((entry) => entry.id === "chat_1" && "updatedAt" in entry.value));
});

test("updateParticipant skips empty patches and writes nullable persona fields intentionally", async () => {
  const empty = buildCtx({
    records: { p1: { _id: "p1", userId: "user_1", chatId: "chat_1" } },
    tableRows: { autonomousSessions: [] },
  });
  await (updateParticipant as any)._handler(empty.ctx, { participantId: "p1" });
  assert.deepEqual(empty.patches, []);

  const state = buildCtx({
    records: {
      chat_1: { _id: "chat_1", userId: "user_1", subagentOverride: "enabled" },
      p1: { _id: "p1", userId: "user_1", chatId: "chat_1" },
    },
    tableRows: {
      autonomousSessions: [],
      chatParticipants: [{ _id: "p1", chatId: "chat_1", sortOrder: 0 }],
    },
  });
  await (updateParticipant as any)._handler(state.ctx, {
    participantId: "p1",
    modelId: "model_new",
    personaEmoji: null,
    personaAvatarImageUrl: null,
  });

  assert.deepEqual(state.patches[0].value, {
    modelId: "model_new",
    personaEmoji: undefined,
    personaAvatarImageUrl: undefined,
  });
  assert.equal(state.patches.some((entry) => entry.id === "chat_1"), true);
});

test("setParticipants atomically replaces participant rows and validates count bounds", async () => {
  const base = {
    records: { chat_1: { _id: "chat_1", userId: "user_1", subagentOverride: "enabled" } },
    tableRows: { autonomousSessions: [], chatParticipants: [] },
  };

  await assert.rejects(
    (setParticipants as any)._handler(buildCtx(base).ctx, { chatId: "chat_1", participants: [] }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "VALIDATION",
  );

  const state = buildCtx({
    records: { chat_1: { _id: "chat_1", userId: "user_1", subagentOverride: "enabled" } },
    tableRows: {
      autonomousSessions: [],
      chatParticipants: [{ _id: "old_1", chatId: "chat_1" }],
    },
  });
  await (setParticipants as any)._handler(state.ctx, {
    chatId: "chat_1",
    participants: [
      { modelId: "model_1", personaEmoji: null },
      { modelId: "model_2", personaAvatarImageUrl: null },
    ],
  });

  assert.deepEqual(state.deletes, ["old_1"]);
  assert.deepEqual(state.inserts.map((entry) => entry.value.sortOrder), [0, 1]);
  assert.equal(state.inserts[0].value.personaEmoji, undefined);
  assert.equal(state.patches.find((entry) => entry.id === "chat_1")?.value.subagentOverride, undefined);
});
