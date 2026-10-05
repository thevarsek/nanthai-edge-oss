import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { evidenceCandidateValidator } from "./source_evidence";

export const retain = internalMutation({
  args: { jobId: v.id("generationJobs"), userId: v.string(), candidates: v.array(evidenceCandidateValidator) },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (job?.userId !== args.userId || !["queued", "streaming"].includes(job.status)) return;
    await ctx.db.patch(job._id, { runtimeEvidenceSources: args.candidates });
  },
});
