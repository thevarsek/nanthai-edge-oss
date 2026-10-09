import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { assertCurrentFence } from "../execution/control_plane";
import { dependencyNodes, workError } from "./work_helpers";
import { workDependenciesCommitted } from "./work_policy";

const terminalJobs = new Set(["completed", "failed", "cancelled", "timedOut"]);

export async function claimWorkForJob(
  ctx: MutationCtx, work: Doc<"collaborationWork">, job: Doc<"generationJobs">,
  deadlineAt: number,
) {
  if (!job.executionAttemptId || job.executionFence === undefined || !job.executionRunId) {
    workError("Work execution is not owned by an active attempt.");
  }
  await assertCurrentFence(ctx, job.executionAttemptId, job.executionFence);
  if (work.claim?.jobId === job._id) return;
  if (work.claim) {
    const previous = await ctx.db.get(work.claim.jobId);
    if (previous && !terminalJobs.has(previous.status) && work.claim.expiresAt > Date.now()) {
      workError("This work already has a running owner.");
    }
  }
  const rows = await ctx.db.query("collaborationWork")
    .withIndex("by_chat", (q) => q.eq("chatId", work.chatId)).collect();
  if (!workDependenciesCommitted({ dependencyIds: work.dependencyIds.map(String) }, dependencyNodes(rows))) {
    workError("Required dependency evidence is still pending.");
  }
  const role = work.status === "review" && work.reviewerIds.includes(job.chatParticipantId as Id<"chatParticipants">)
    ? "reviewer" as const : "owner" as const;
  if (role === "owner" && work.assigneeId && work.assigneeId !== job.chatParticipantId) workError("This Persona is not the assigned owner.");
  if (!job.chatParticipantId) workError("The selected owner is unavailable.");
  await ctx.db.patch(work._id, {
    ...(role === "owner" && !work.assigneeId ? { assigneeId: job.chatParticipantId } : {}),
    // A new owner captures current committed dependencies. Later invalidations
    // remain set until this claim publishes or the owner explicitly retries.
    ...(role === "owner" ? { needsRevalidation: false } : {}),
    claim: { jobId: job._id, attemptId: job.executionAttemptId, fence: job.executionFence,
      expiresAt: deadlineAt, requirementRevision: work.requirementRevision, role },
    status: role === "reviewer" ? "review" : "in_progress",
    linkedRunIds: [...new Set([...work.linkedRunIds, job.executionRunId])],
    revision: work.revision + 1, blocker: undefined, updatedAt: Date.now(),
  });
}

export async function requireWorkClaim(ctx: MutationCtx, args: {
  userId: string; workId: Id<"collaborationWork">; jobId: Id<"generationJobs">;
  attemptId: Id<"executionAttempts">; fence: number;
}) {
  await assertCurrentFence(ctx, args.attemptId, args.fence);
  const [work, job] = await Promise.all([ctx.db.get(args.workId), ctx.db.get(args.jobId)]);
  if (!work || !job || work.userId !== args.userId || job.userId !== args.userId
    || work.chatId !== job.chatId || job.executionAttemptId !== args.attemptId
    || job.executionFence !== args.fence || work.claim?.jobId !== args.jobId
    || work.claim.attemptId !== args.attemptId || work.claim.fence !== args.fence
    || work.claim.expiresAt <= Date.now()) {
    workError("This work claim has expired or belongs to another execution.");
  }
  return { work, job };
}
