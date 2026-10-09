import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { wakeCollaboration } from "./wake_events";

export async function publishCollaborationJobTerminal(ctx: MutationCtx, job: Doc<"generationJobs">) {
  if (!job.collaborationExchangeId) return;
  const rows = await ctx.db.query("collaborationWork")
    .withIndex("by_chat", (q) => q.eq("chatId", job.chatId)).collect();
  const message = await ctx.db.get(job.messageId);
  // The provider job may finish before finalization commits its public reply.
  // Only the committed message boundary can release evidence or wake peers.
  if (job.status === "completed" && message && !["completed", "failed", "cancelled"].includes(message.status)) return;
  for (const work of rows) {
    if (work.claim?.jobId !== job._id) continue;
    const publication = work.pendingPublication;
    const validOutput = job.status === "completed" && message?.status === "completed"
      && work.claim.expiresAt > Date.now() && work.claim.attemptId === job.executionAttemptId
      && work.claim.fence === job.executionFence;
    if (validOutput && publication) {
      const needsRevalidation = work.needsRevalidation
        || work.claim.requirementRevision !== work.requirementRevision;
      await ctx.db.patch(work._id, {
        status: work.reviewerIds.length === 0 && !needsRevalidation ? "done" : "review", claim: undefined, pendingPublication: undefined,
        evidenceRevision: work.evidenceRevision + 1,
        sourceRevision: publication.sourceRevision,
        evidence: [{ messageId: job.messageId, ...publication }],
        needsRevalidation,
        revision: work.revision + 1, updatedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(work._id, {
        claim: undefined, pendingPublication: undefined,
        status: "blocked", blocker: work.blocker ?? (validOutput
          ? "The owner finished without publishing acceptance evidence. Retry or reassign explicitly."
          : job.error ?? "The owner did not complete. Retry or reassign explicitly."),
        revision: work.revision + 1, updatedAt: Date.now(),
      });
    }
  }
  await wakeCollaboration(ctx, job.collaborationExchangeId);
}
