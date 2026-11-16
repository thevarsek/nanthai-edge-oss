import assert from "node:assert/strict";
import test from "node:test";
import type { MutationCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { addParticipant, updateParticipant, setParticipants } from "../participants/mutations";
import { createFavorite, updateFavorite } from "../favorites/mutations";
import { listFavorites } from "../favorites/queries";

function handler(fn: unknown) {
  return (fn as { _handler: (ctx: MutationCtx, args: object) => Promise<unknown> })._handler;
}
for (const personaOwner of ["user_1", "other-user", null]) {
  test(`persona references require an existing owned persona (${personaOwner})`, async () => {
    const writes = [
      [addParticipant, { chatId: "chat", modelId: "model", personaId: "persona" }],
      [updateParticipant, { participantId: "participant", personaId: "persona" }],
      [setParticipants, { chatId: "chat", participants: [{ modelId: "model", personaId: "persona" }] }],
      [createFavorite, { name: "favorite", participants: [{ modelId: "model", personaId: "persona" }] }],
      [createFavorite, { name: "legacy", modelIds: ["model"], personaId: "persona" }],
      [updateFavorite, { favoriteId: "favorite", participants: [{ modelId: "model", personaId: "persona" }] }],
      [updateFavorite, { favoriteId: "favorite", personaId: "persona" }],
    ] as const;
    for (const [fn, args] of writes) {
      const rows = {
        personas: personaOwner ? [{ _id: "persona", userId: personaOwner }] : [],
        chats: [{ _id: "chat", userId: "user_1" }],
        chatParticipants: [{ _id: "participant", chatId: "chat", userId: "user_1" }],
        favorites: [{ _id: "favorite", userId: "user_1", sortOrder: 0 }],
      };
      const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx;
      Object.assign(ctx.db, { system: {} });
      if (personaOwner === "user_1") await handler(fn)(ctx, args);
      else await assert.rejects(handler(fn)(ctx, args), /Persona not found/);
    }
  });
}
test("favorite reads do not resolve foreign persona avatars from persisted legacy references", async () => {
  const rows = {
    favorites: [{ _id: "favorite", userId: "user_1", personaId: "foreign", modelIds: ["model"], sortOrder: 0 }],
    personas: [{ _id: "foreign", userId: "victim", avatarImageStorageId: "victim-avatar" }],
  };
  const mock = createStatefulMockCtx(rows);
  Object.assign((mock as unknown as MutationCtx).db, { system: {} });
  let requested = 0;
  Object.assign(mock.storage, { getUrl: async () => { requested += 1; return "victim-avatar-url"; } });
  const favorites = await handler(listFavorites)(mock as unknown as MutationCtx, {}) as Array<{ personaAvatarImageUrl?: string }>;
  assert.equal(requested, 0);
  assert.equal(favorites.length, 1);
  assert.equal(favorites[0].personaAvatarImageUrl, undefined);
});
