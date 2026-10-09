import { v, type Infer } from "convex/values";
import { internalMutation, mutation, type MutationCtx } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import type { Doc } from "../_generated/dataModel";
import { invalidateDependents, requireWork, workError } from "./work_helpers";
import { requireWorkClaim } from "./work_claims";
import { wakeWorkChat } from "./wake_events";
import { assertCurrentFence } from "../execution/control_plane";
import { pendingWorkReviewerIds } from "./work_review_policy";

export async function commitWorkReview(ctx: MutationCtx, work: Doc<"collaborationWork">, args: {
  requirementRevision: number; evidenceRevision: number; sourceRevision: string;
  outcome: "accept" | "rework" | "override"; reason: string; author: string;
  reviewerId?: Doc<"collaborationWork">["assigneeId"];
}) {
  if (!args.reason.trim()) workError("Describe the review evidence or human override reason.");
  if (work.requirementRevision !== args.requirementRevision
    || work.evidenceRevision !== args.evidenceRevision || (work.sourceRevision ?? "") !== args.sourceRevision
    || (args.outcome === "accept" && (work.needsRevalidation || work.evidence.length === 0))) {
    workError("This review no longer matches the current requirements and evidence.");
  }
  const now = Date.now();
  await ctx.db.insert("collaborationReviews", {
    userId: work.userId, chatId: work.chatId, workId: work._id, ...args, createdAt: now,
  });
  const remainingReviewers = args.outcome === "accept" && args.reviewerId
    ? await pendingWorkReviewerIds(ctx, work) : [];
  await ctx.db.patch(work._id, {
    status: args.outcome === "rework" ? "open" : remainingReviewers.length ? "review" : "done", claim: undefined,
    pendingPublication: undefined, needsRevalidation: false,
    blocker: args.outcome === "rework" ? args.reason : undefined,
    revision: work.revision + 1, updatedAt: now,
  });
  if (args.outcome === "rework") await invalidateDependents(ctx, work);
  await wakeWorkChat(ctx, work.chatId);
  return null;
}

export const reviewWork = mutation({
  args: {
    workId: v.id("collaborationWork"), revision: v.number(), requirementRevision: v.number(),
    evidenceRevision: v.number(), sourceRevision: v.string(),
    outcome: v.union(v.literal("accept"), v.literal("rework"), v.literal("override")), reason: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const work = await requireWork(ctx, userId, args.workId, args.revision);
    return await commitWorkReview(ctx, work, {
      requirementRevision: args.requirementRevision, evidenceRevision: args.evidenceRevision,
      sourceRevision: args.sourceRevision, outcome: args.outcome, reason: args.reason, author: userId,
    });
  },
});

const workResultArgs = {
    userId: v.string(), workId: v.id("collaborationWork"), jobId: v.id("generationJobs"),
    attemptId: v.id("executionAttempts"), fence: v.number(),
    action: v.union(v.literal("publish"), v.literal("block"), v.literal("accept"), v.literal("rework")),
    description: v.string(), sourceRevision: v.string(),
    requirementRevision: v.number(), evidenceRevision: v.number(),
    operationKey: v.string(),
};
const workResultValidator = v.object(workResultArgs);
export async function proposeWorkResultHandler(ctx: MutationCtx, args: Infer<typeof workResultValidator>) {
    await assertCurrentFence(ctx, args.attemptId, args.fence);
    const existing = await ctx.db.query("collaborationWorkOperations")
      .withIndex("by_key", (q) => q.eq("userId", args.userId).eq("operationKey", args.operationKey)).unique();
    const inputJson = JSON.stringify([args.workId, args.action, args.description, args.sourceRevision,
      args.requirementRevision, args.evidenceRevision]);
    if (existing) {
      if (existing.inputJson !== inputJson) workError("This work operation identity changed.");
      return null;
    }
    const { work, job } = await requireWorkClaim(ctx, args);
    await ctx.db.insert("collaborationWorkOperations", {
      userId: args.userId, chatId: work.chatId, workId: work._id,
      operationKey: args.operationKey, inputJson, createdAt: Date.now(),
    });
    if (args.action === "accept" || args.action === "rework") {
      if (work.claim?.role !== "reviewer" || !job.chatParticipantId
        || !work.reviewerIds.includes(job.chatParticipantId)) workError("This Persona is not the assigned reviewer.");
      return await commitWorkReview(ctx, work, {
        requirementRevision: args.requirementRevision, evidenceRevision: args.evidenceRevision,
        sourceRevision: args.sourceRevision, outcome: args.action, reason: args.description,
        author: String(job.chatParticipantId), reviewerId: job.chatParticipantId,
      });
    }
    if (work.claim?.role !== "owner") workError("Only the work owner can publish or block its result.");
    if (!args.description.trim()) workError("Describe the result or blocker.");
    await ctx.db.patch(work._id, args.action === "publish" ? {
      pendingPublication: { description: args.description, sourceRevision: args.sourceRevision },
      revision: work.revision + 1, updatedAt: Date.now(),
    } : {
      status: "blocked", blocker: args.description, pendingPublication: undefined,
      revision: work.revision + 1, updatedAt: Date.now(),
    });
    return null;
}

export const proposeWorkResult = internalMutation({ args: workResultValidator, handler: proposeWorkResultHandler });
