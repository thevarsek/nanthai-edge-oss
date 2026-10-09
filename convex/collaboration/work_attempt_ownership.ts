import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// Called only inside the canonical atomic supersession of this same run.
export async function transferWorkAttempt(
  ctx: MutationCtx, run: Doc<"executionRuns">, previous: Doc<"executionAttempts">,
  next: { attemptId: Id<"executionAttempts">; fence: number }, now: number,
) {
  if (!run.generationJobId || !run.chatId) return;
  const chatId = run.chatId;
  const work = await ctx.db.query("collaborationWork")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId)).collect();
  for (const row of work) {
    if (row.userId !== run.userId || row.claim?.jobId !== run.generationJobId
      || row.claim.attemptId !== previous._id || row.claim.fence !== previous.fence
      || row.claim.expiresAt <= now) continue;
    await ctx.db.patch(row._id, { claim: { ...row.claim, ...next }, updatedAt: now });
  }
}
