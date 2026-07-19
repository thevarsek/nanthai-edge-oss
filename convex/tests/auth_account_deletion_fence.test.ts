import assert from "node:assert/strict";
import test from "node:test";
import { requireAuth } from "../lib/auth";

function authCtx(tombstone: Record<string, unknown> | null) {
  return {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1", email: "user@example.com" }),
    },
    db: {
      system: {},
      query: (table: string) => {
        assert.equal(table, "accountDeletionTombstones");
        return {
          withIndex: () => ({ unique: async () => tombstone }),
        };
      },
    },
  } as never;
}

test("requireAuth rejects writes after the account deletion fence is installed", async () => {
  await assert.rejects(
    requireAuth(authCtx({ userId: "user_1", requestedAt: 1 })),
    (error: unknown) => {
      assert.deepEqual((error as { data?: unknown }).data, {
        code: "ACCOUNT_DELETION_IN_PROGRESS",
        message: "Account deletion is in progress.",
      });
      return true;
    },
  );
});

test("requireAuth permits the deletion action to retry behind its own fence", async () => {
  const user = await requireAuth(
    authCtx({ userId: "user_1", requestedAt: 1 }),
    { allowAccountDeletion: true },
  );
  assert.equal(user.userId, "user_1");
});
