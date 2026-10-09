import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export async function pendingWorkReviewerIds(
  ctx: MutationCtx | QueryCtx, work: Doc<"collaborationWork">,
) {
  const reviews = await ctx.db.query("collaborationReviews")
    .withIndex("by_work", q => q.eq("workId", work._id)).order("asc").collect();
  const outcomes = new Map<string, string>();
  for (const review of reviews) {
    if (review.reviewerId && review.requirementRevision === work.requirementRevision
      && review.evidenceRevision === work.evidenceRevision
      && review.sourceRevision === (work.sourceRevision ?? "")) {
      outcomes.set(review.reviewerId, review.outcome);
    }
  }
  return work.reviewerIds.filter(id => outcomes.get(id) !== "accept");
}

export type EligibleWork = Doc<"collaborationWork"> & {
  pendingReviewerIds: Doc<"collaborationWork">["reviewerIds"];
};
