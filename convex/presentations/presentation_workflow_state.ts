import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { TERMINAL_GENERATION_JOB_STATUSES } from "../chat/generation_continuation_shared";

export const getPresentationWorkflowState = internalQuery({
  args: {
    projectId: v.id("presentationProjects"),
    userId: v.string(),
    jobId: v.id("generationJobs"),
    runId: v.optional(v.id("presentationGenerationRuns")),
  },
  returns: v.object({
    active: v.boolean(),
    projectStatus: v.union(v.string(), v.null()),
    projectRevision: v.union(v.number(), v.null()),
    runStatus: v.union(v.string(), v.null()),
    finalizedRevision: v.union(v.number(), v.null()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const [job, project, run] = await Promise.all([
      ctx.db.get(args.jobId),
      ctx.db.get(args.projectId),
      args.runId ? ctx.db.get(args.runId) : null,
    ]);
    const owned = project?.userId === args.userId;
    const active = Boolean(
      owned &&
      job?.userId === args.userId &&
      !TERMINAL_GENERATION_JOB_STATUSES.has(job.status),
    );
    return {
      active,
      projectStatus: owned ? project.status : null,
      projectRevision: owned ? project.revision : null,
      runStatus: run?.projectId === args.projectId && run.userId === args.userId
        ? run.status
        : null,
      finalizedRevision: run?.projectId === args.projectId && run.userId === args.userId
        ? run.projectRevision
        : null,
      ...((run?.error ?? project?.error) ? { error: run?.error ?? project?.error } : {}),
    };
  },
});
export const PRESENTATION_RUN_TERMINAL_EVENT = "presentation-run-terminal";
