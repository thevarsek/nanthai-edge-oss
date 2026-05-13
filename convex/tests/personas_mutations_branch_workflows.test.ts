import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";

import {
  create,
  createPersonaInternal,
  remove,
  removePersonaInternal,
  update,
} from "../personas/mutations";

function buildCtx(options?: {
  records?: Record<string, Record<string, any>>;
  tableRows?: Record<string, Array<Record<string, any>>>;
  userId?: string | null;
}) {
  const records = new Map(Object.entries(options?.records ?? {}));
  const tableRows = new Map(Object.entries(options?.tableRows ?? {}));
  const inserts: Array<{ table: string; value: Record<string, any>; id: string }> = [];
  const patches: Array<{ id: string; value: Record<string, any> }> = [];
  const deletes: string[] = [];
  const storageDeletes: string[] = [];
  const rowsFor = (table: string) => tableRows.get(table) ?? [];

  const ctx = {
    auth: {
      getUserIdentity: async () =>
        options?.userId === null ? null : { subject: options?.userId ?? "user_1" },
    },
    db: {
      get: async (id: string) => records.get(id) ?? null,
      insert: async (table: string, value: Record<string, any>) => {
        const id = `${table}_${inserts.length + 1}`;
        inserts.push({ table, value, id });
        records.set(id, { _id: id, ...value });
        return id;
      },
      patch: async (id: string, value: Record<string, any>) => {
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
            first: async () => rowsFor(table).find((row) =>
              filters.every(([field, value]) => row[field] === value),
            ) ?? null,
            collect: async () => rowsFor(table).filter((row) =>
              filters.every(([field, value]) => row[field] === value),
            ),
          };
        },
      }),
    },
    storage: {
      delete: async (id: string) => {
        storageDeletes.push(id);
      },
    },
  } as any;

  return { ctx, inserts, patches, deletes, storageDeletes };
}

const proRows = {
  purchaseEntitlements: [{ _id: "ent_1", userId: "user_1", status: "active" }],
};

test("create persona enforces pro auth and unsets previous defaults", async () => {
  await assert.rejects(
    (create as any)._handler(buildCtx({ userId: null }).ctx, {
      displayName: "Writer",
      systemPrompt: "Write",
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "AUTH_REQUIRED",
  );

  const state = buildCtx({
    tableRows: {
      ...proRows,
      personas: [{ _id: "old_default", userId: "user_1", isDefault: true }],
    },
  });
  const id = await (create as any)._handler(state.ctx, {
    displayName: "Writer",
    systemPrompt: "Write clearly.",
    avatarImageStorageId: null,
    isDefault: true,
  });

  assert.equal(id, "personas_1");
  assert.equal(state.patches[0].id, "old_default");
  assert.equal(state.patches[0].value.isDefault, false);
  assert.equal(state.inserts[0].value.avatarImageStorageId, undefined);
  assert.equal(state.inserts[0].value.isDefault, true);
});

test("update persona handles ownership, default swaps, avatar replacement, and nullable clears", async () => {
  await assert.rejects(
    (update as any)._handler(buildCtx({ tableRows: proRows }).ctx, {
      personaId: "missing",
      displayName: "Nope",
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "NOT_FOUND",
  );

  const state = buildCtx({
    records: {
      persona_1: {
        _id: "persona_1",
        userId: "user_1",
        avatarImageStorageId: "old_avatar",
      },
    },
    tableRows: {
      ...proRows,
      personas: [
        { _id: "persona_1", userId: "user_1", isDefault: false },
        { _id: "persona_2", userId: "user_1", isDefault: true },
      ],
    },
  });
  await (update as any)._handler(state.ctx, {
    personaId: "persona_1",
    displayName: "Updated",
    avatarImageStorageId: null,
    isDefault: true,
  });

  assert.equal(state.patches[0].id, "persona_2");
  assert.equal(state.patches[0].value.isDefault, false);
  assert.equal(state.patches[1].id, "persona_1");
  assert.equal(state.patches[1].value.avatarImageStorageId, undefined);
  assert.deepEqual(state.storageDeletes, ["old_avatar"]);
});

test("remove persona and internal persona mutations delete avatar blobs and protect ownership", async () => {
  await assert.rejects(
    (removePersonaInternal as any)._handler(buildCtx({
      records: { persona_1: { _id: "persona_1", userId: "other_user" } },
    }).ctx, { personaId: "persona_1", userId: "user_1" }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "NOT_FOUND",
  );

  const created = buildCtx();
  await (createPersonaInternal as any)._handler(created.ctx, {
    userId: "user_1",
    displayName: "Internal",
    systemPrompt: "Act",
    avatarImageStorageId: null,
  });
  assert.equal(created.inserts[0].value.isDefault, false);
  assert.equal(created.inserts[0].value.avatarImageStorageId, undefined);

  const state = buildCtx({
    records: {
      persona_1: { _id: "persona_1", userId: "user_1", avatarImageStorageId: "avatar_1" },
      persona_2: { _id: "persona_2", userId: "user_1", avatarImageStorageId: "avatar_2" },
    },
    tableRows: proRows,
  });
  await (remove as any)._handler(state.ctx, { personaId: "persona_1" });
  await (removePersonaInternal as any)._handler(state.ctx, {
    personaId: "persona_2",
    userId: "user_1",
  });

  assert.deepEqual(state.storageDeletes, ["avatar_1", "avatar_2"]);
  assert.deepEqual(state.deletes, ["persona_1", "persona_2"]);
});
