import assert from "node:assert/strict";
import test from "node:test";
import { deleteAdvisorRunAndReclaimAvatar } from "../advisors/avatar_storage";

type CleanupRun = Parameters<typeof deleteAdvisorRunAndReclaimAvatar>[1];
type IndexQuery = { eq: (field: string, value: unknown) => IndexQuery };

test("historical Persona avatars are reclaimed only after their last Advisor run", async () => {
  const runs = [
    { _id: "run_1", personaId: "persona_1", personaAvatarStorageId: "avatar_old" },
    { _id: "run_2", personaId: "persona_1", personaAvatarStorageId: "avatar_old" },
    { _id: "run_3", personaId: "persona_1", personaAvatarStorageId: "avatar_current" },
  ];
  const deletedStorage: string[] = [];
  const ctx = {
    db: {
      delete: async (id: string) => {
        const index = runs.findIndex((run) => run._id === id);
        if (index >= 0) runs.splice(index, 1);
      },
      get: async (id: string) => id === "persona_1"
        ? { _id: "persona_1", avatarImageStorageId: "avatar_current" }
        : null,
      query: () => ({
        withIndex: (_index: string, apply: (query: IndexQuery) => void) => {
          const filters: Array<[string, unknown]> = [];
          const query: IndexQuery = {
            eq: (field, value) => {
              filters.push([field, value]);
              return query;
            },
          };
          apply(query);
          return {
            first: async () => runs.find((run) =>
              filters.every(([field, value]) => run[field as keyof typeof run] === value)
            ) ?? null,
          };
        },
      }),
    },
    storage: { delete: async (id: string) => { deletedStorage.push(id); } },
  } as unknown as Parameters<typeof deleteAdvisorRunAndReclaimAvatar>[0];

  await deleteAdvisorRunAndReclaimAvatar(ctx, runs[0] as CleanupRun);
  assert.deepEqual(deletedStorage, []);
  await deleteAdvisorRunAndReclaimAvatar(ctx, runs[0] as CleanupRun);
  assert.deepEqual(deletedStorage, ["avatar_old"]);
  await deleteAdvisorRunAndReclaimAvatar(ctx, runs[0] as CleanupRun);
  assert.deepEqual(deletedStorage, ["avatar_old"], "the Persona still owns its current avatar");
});
