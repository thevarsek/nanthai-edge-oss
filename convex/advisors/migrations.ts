import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { conciseAdvisorFailure } from "../lib/openrouter_responses_error";

const PAGE_SIZE = 200;

/** Remove legacy SDK/request dumps persisted before Advisor error sanitization. */
export const scrubUnsafeAdvisorErrors = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    scannedCount: v.number(),
    scrubbedCount: v.number(),
    isComplete: v.boolean(),
    nextCursor: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("advisorRuns")
      .paginate({ cursor: args.cursor ?? null, numItems: PAGE_SIZE });
    let scrubbedCount = 0;

    for (const run of page.page) {
      if (!run.errorMessage) continue;
      const sanitized = conciseAdvisorFailure(run.errorMessage);
      if (sanitized === run.errorMessage) continue;
      scrubbedCount += 1;
      if (!(args.dryRun ?? false)) {
        await ctx.db.patch(run._id, { errorMessage: sanitized });
      }
    }

    return {
      scannedCount: page.page.length,
      scrubbedCount,
      isComplete: page.isDone,
      nextCursor: page.isDone ? undefined : page.continueCursor,
    };
  },
});
