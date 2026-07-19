import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

/** Compare-and-swap a presentation onto a replacement parent Workflow event. */
export const rebindPresentationParentEvent = internalMutation({
  args: {
    jobId: v.id("generationJobs"),
    userId: v.string(),
    toolCallId: v.string(),
    expectedEventId: v.string(),
    nextEventId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== args.userId) return false;
    const projects = await ctx.db
      .query("presentationProjects")
      .withIndex("by_origin_assistant", (query) =>
        query.eq("originAssistantMessageId", job.messageId)
      )
      .collect();
    const project = projects.find((candidate) =>
      candidate.userId === args.userId &&
      candidate.originToolCallId === args.toolCallId
    );
    if (!project || project.parentResumeEventId !== args.expectedEventId) {
      return false;
    }
    await ctx.db.patch(project._id, {
      parentResumeEventId: args.nextEventId,
      updatedAt: Date.now(),
    });
    return true;
  },
});
