import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/** The canonical exchange owns its scheduler's budget across every wave. */
export async function getCollaborationDecisionDeadline(
  ctx: Pick<QueryCtx, "db">,
  parentRun: Doc<"executionRuns"> | null,
): Promise<number | undefined> {
  if (parentRun?.domainType !== "collaboration_exchange" || !parentRun.domainId) {
    return undefined;
  }
  const exchange = await ctx.db.get(parentRun.domainId as Id<"collaborationExchanges">);
  return exchange?.bounds.deadlineAt;
}

export function assertCollaborationDecisionDeadline(deadlineAt: number | undefined): void {
  if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
    throw new Error("COLLABORATION_BARRIER_TIMEOUT");
  }
}
