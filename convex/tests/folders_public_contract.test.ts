import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import {
  create,
  moveChat,
  remove,
  update,
} from "../folders/mutations";

function authCtx(userId = "user_1") {
  return {
    auth: {
      getUserIdentity: async () => ({ subject: userId }),
    },
  };
}

test("folder create assigns the next sort order when omitted", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];

  const result = await (create as any)._handler(
    {
      ...authCtx(),
      db: {
        query: () => ({
          withIndex: () => ({
            collect: async () => [
              { _id: "folder_1", userId: "user_1", sortOrder: 0 },
              { _id: "folder_2", userId: "user_1", sortOrder: 3 },
            ],
          }),
        }),
        insert: async (table: string, value: Record<string, unknown>) => {
          inserts.push({ table, value });
          return "folder_new";
        },
      },
    } as any,
    { name: "Research", color: "#00AA88" },
  );

  assert.equal(result, "folder_new");
  assert.equal(inserts[0]?.table, "folders");
  assert.equal(inserts[0]?.value.sortOrder, 4);
  assert.equal(inserts[0]?.value.name, "Research");
  assert.equal(inserts[0]?.value.color, "#00AA88");
});

test("folder update rejects foreign ownership", async () => {
  await assert.rejects(
    (update as any)._handler(
      {
        ...authCtx(),
        db: {
          get: async () => ({ _id: "folder_1", userId: "user_2" }),
        },
      } as any,
      { folderId: "folder_1", name: "Updated" },
    ),
    (error: unknown) => {
      assert.ok(error instanceof ConvexError);
      return (error as ConvexError<any>).data?.code === "NOT_FOUND";
    },
  );
});

test("folder remove unfiles chats before deleting the folder", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const deleted: string[] = [];

  await (remove as any)._handler(
    {
      ...authCtx(),
      db: {
        get: async (id: string) =>
          id === "folder_1" ? { _id: "folder_1", userId: "user_1" } : null,
        query: () => ({
          withIndex: () => ({
            collect: async () => [
              { _id: "chat_1", userId: "user_1", folderId: "folder_1" },
              { _id: "chat_2", userId: "user_1", folderId: "folder_1" },
            ],
          }),
        }),
        patch: async (id: string, patch: Record<string, unknown>) => {
          patches.push({ id, patch });
        },
        delete: async (id: string) => {
          deleted.push(id);
        },
      },
    } as any,
    { folderId: "folder_1" },
  );

  assert.deepEqual(patches, [
    { id: "chat_1", patch: { folderId: undefined } },
    { id: "chat_2", patch: { folderId: undefined } },
  ]);
  assert.deepEqual(deleted, ["folder_1"]);
});

test("moveChat patches only folderId for organizational moves", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

  await (moveChat as any)._handler(
    {
      ...authCtx(),
      db: {
        get: async (id: string) => {
          if (id === "chat_1") return { _id: "chat_1", userId: "user_1" };
          if (id === "folder_1") return { _id: "folder_1", userId: "user_1" };
          return null;
        },
        patch: async (id: string, patch: Record<string, unknown>) => {
          patches.push({ id, patch });
        },
      },
    } as any,
    { chatId: "chat_1", folderId: "folder_1" },
  );

  assert.deepEqual(patches, [{ id: "chat_1", patch: { folderId: "folder_1" } }]);
  assert.equal("updatedAt" in (patches[0]?.patch ?? {}), false);
});
