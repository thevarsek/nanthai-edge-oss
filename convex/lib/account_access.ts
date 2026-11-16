// convex/lib/account_access.ts
// One account-access fence: the account-deletion tombstone plus the account
// access block. Every authentication path and background writer fence uses it.

import { ConvexError } from "convex/values";
import type { QueryCtx } from "../_generated/server";

type Reader = QueryCtx["db"];

export type AccountAccessState = "active" | "deleting" | "blocked";

export async function accountAccessState(db: Reader, userId: string): Promise<AccountAccessState> {
  const tombstone = await db
    .query("accountDeletionTombstones")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  // Compare the owner explicitly so partial index mocks cannot widen the fence.
  if (tombstone && tombstone.userId === userId) return "deleting";
  const block = await db
    .query("accountAccessBlocks")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  return block && block.userId === userId ? "blocked" : "active";
}

export async function isAccountActive(db: Reader, userId: string): Promise<boolean> {
  return (await accountAccessState(db, userId)) === "active";
}

export function accountAccessError(state: Exclude<AccountAccessState, "active">): ConvexError<{
  code: "ACCOUNT_DELETION_IN_PROGRESS" | "ACCOUNT_BLOCKED";
  message: string;
}> {
  return state === "deleting"
    ? new ConvexError({
      code: "ACCOUNT_DELETION_IN_PROGRESS" as const,
      message: "Account deletion is in progress.",
    })
    : new ConvexError({
      code: "ACCOUNT_BLOCKED" as const,
      message: "This account is not available. Contact support if you think this is a mistake.",
    });
}

/** Throw the structured account error unless the account is active. */
export async function assertAccountActive(db: Reader, userId: string): Promise<void> {
  const state = await accountAccessState(db, userId);
  if (state !== "active") throw accountAccessError(state);
}
