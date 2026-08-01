import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

const removableStates = [
  "dispatching",
  "awaiting_input",
  "task_pending",
  "failed",
  "cancelled",
  "outcome_unknown",
] as const;

async function deleteInvocations(
  ctx: MutationCtx,
  invocations: Doc<"mcpInvocations">[],
): Promise<void> {
  for (const invocation of invocations) {
    for (const item of invocation.contentItems ?? []) {
      if (item.storageId) await ctx.storage.delete(item.storageId).catch(() => undefined);
    }
    await ctx.db.delete(invocation._id);
  }
}

/**
 * Deletes one bounded page of connection-owned work while retaining completed
 * invocations attached to transcript messages. Chat/account deletion owns the
 * later reclamation of those historical rows and their stored content.
 */
export async function deleteDisconnectableInvocationPage(
  ctx: MutationCtx,
  connectionId: Id<"mcpConnections">,
  limit: number,
): Promise<boolean> {
  const invocations: Doc<"mcpInvocations">[] = [];
  for (const state of removableStates) {
    const remaining = limit - invocations.length;
    if (remaining <= 0) break;
    invocations.push(...await ctx.db
      .query("mcpInvocations")
      .withIndex("by_connection_state", (query) => query
        .eq("connectionId", connectionId)
        .eq("state", state))
      .take(remaining));
  }

  const remaining = limit - invocations.length;
  if (remaining > 0) {
    invocations.push(...await ctx.db
      .query("mcpInvocations")
      .withIndex("by_connection_state", (query) => query
        .eq("connectionId", connectionId)
        .eq("state", "completed"))
      .filter((query) => query.eq(query.field("messageId"), undefined))
      .take(remaining));
  }

  await deleteInvocations(ctx, invocations);
  return invocations.length === limit;
}
