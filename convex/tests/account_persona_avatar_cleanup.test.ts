import assert from "node:assert/strict";
import test from "node:test";
import { deleteUserTableBatch } from "../account/mutations";

test("account deletion reclaims current Persona avatars after Advisor history cleanup", async () => {
  const deletedRows: string[] = [];
  const deletedStorage: string[] = [];
  const result = await (deleteUserTableBatch as unknown as {
    _handler: (
      ctx: unknown,
      args: { userId: string; tableName: string },
    ) => Promise<{ deleted: number }>;
  })._handler({
    db: {
      query: () => ({
        withIndex: () => ({
          take: async () => [
            { _id: "persona_1", avatarImageStorageId: "avatar_1" },
            { _id: "persona_2" },
          ],
        }),
      }),
      delete: async (id: string) => { deletedRows.push(id); },
    },
    storage: {
      delete: async (id: string) => { deletedStorage.push(id); },
    },
  }, { userId: "user_1", tableName: "personas" });

  assert.equal(result.deleted, 2);
  assert.deepEqual(deletedRows, ["persona_1", "persona_2"]);
  assert.deepEqual(deletedStorage, ["avatar_1"]);
});
