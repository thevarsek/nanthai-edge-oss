import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import {
  createFavorite,
  reorderFavorites,
} from "../favorites/mutations";
import { listFavorites } from "../favorites/queries";

function buildAuth(userId: string | null = "user_1") {
  return {
    getUserIdentity: async () => (userId ? { subject: userId } : null),
  };
}

test("createFavorite trims name and appends to end of existing sort order", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];

  const result = await (createFavorite as any)._handler({
    auth: buildAuth(),
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          collect: async () =>
            table === "favorites"
              ? [
                  { _id: "fav_1", sortOrder: 0 },
                  { _id: "fav_2", sortOrder: 3 },
                ]
              : [],
          // M29: validateSameModality queries cachedModels via .first()
          first: async () => null,
        }),
      }),
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return "fav_new";
      },
    },
  }, {
    name: "  Writing Trio  ",
    modelIds: ["a", "b"],
  });

  assert.equal(result, "fav_new");
  assert.equal(inserts[0]?.value.name, "Writing Trio");
  assert.equal(inserts[0]?.value.sortOrder, 4);
});

test("reorderFavorites rejects partial ordered lists", async () => {
  await assert.rejects(
    (reorderFavorites as any)._handler({
      auth: buildAuth(),
      db: {
        query: () => ({
          withIndex: () => ({
            collect: async () => [
              { _id: "fav_1", userId: "user_1", sortOrder: 0 },
              { _id: "fav_2", userId: "user_1", sortOrder: 1 },
            ],
          }),
        }),
        get: async () => null,
      },
    }, {
      orderedIds: ["fav_1"],
    }),
    (error: unknown) => {
      assert.ok(error instanceof ConvexError);
      return (error as ConvexError<any>).data?.code === "INVALID_ARGS";
    },
  );
});

test("reorderFavorites rejects duplicate ids", async () => {
  await assert.rejects(
    (reorderFavorites as any)._handler({
      auth: buildAuth(),
      db: {
        query: () => ({
          withIndex: () => ({
            collect: async () => [
              { _id: "fav_1", userId: "user_1", sortOrder: 0 },
              { _id: "fav_2", userId: "user_1", sortOrder: 1 },
            ],
          }),
        }),
        get: async (id: string) => ({ _id: id, userId: "user_1", sortOrder: 0 }),
      },
    }, {
      orderedIds: ["fav_1", "fav_1"],
    }),
    (error: unknown) => {
      assert.ok(error instanceof ConvexError);
      return (error as ConvexError<any>).data?.code === "INVALID_ARGS";
    },
  );
});

test("reorderFavorites patches only changed positions after validating ownership", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const favorites = {
    fav_1: { _id: "fav_1", userId: "user_1", sortOrder: 0 },
    fav_2: { _id: "fav_2", userId: "user_1", sortOrder: 1 },
    fav_3: { _id: "fav_3", userId: "user_1", sortOrder: 2 },
  };

  await (reorderFavorites as any)._handler({
    auth: buildAuth(),
    db: {
      query: () => ({
        withIndex: () => ({
          collect: async () => Object.values(favorites),
        }),
      }),
      get: async (id: keyof typeof favorites) => favorites[id],
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
    },
  }, {
    orderedIds: ["fav_3", "fav_2", "fav_1"],
  });

  assert.deepEqual(patches.map((entry) => entry.id), ["fav_3", "fav_1"]);
  assert.equal(patches[0]?.patch.sortOrder, 0);
  assert.equal(patches[1]?.patch.sortOrder, 2);
});

test("listFavorites refreshes persona avatar urls and preserves stale snapshot fallback", async () => {
  const favorites = [
    {
      _id: "fav_1",
      userId: "user_1",
      sortOrder: 0,
      personaId: "persona_1",
      personaAvatarImageUrl: "https://stale.example/avatar.png",
    },
    {
      _id: "fav_2",
      userId: "user_1",
      sortOrder: 1,
      personaId: "persona_missing",
      personaAvatarImageUrl: "https://stale.example/missing.png",
    },
  ];

  const result = await (listFavorites as any)._handler({
    auth: buildAuth(),
    db: {
      query: () => ({
        withIndex: () => ({
          collect: async () => favorites,
        }),
      }),
      get: async (id: string) => {
        if (id === "persona_1") {
          return { _id: "persona_1", avatarImageStorageId: "storage_1" };
        }
        throw new Error("missing persona");
      },
    },
    storage: {
      getUrl: async (id: string) =>
        id === "storage_1" ? "https://fresh.example/avatar.png" : null,
    },
  }, {});

  assert.equal(result[0]?.personaAvatarImageUrl, "https://fresh.example/avatar.png");
  assert.equal(result[1]?.personaAvatarImageUrl, "https://stale.example/missing.png");
});
