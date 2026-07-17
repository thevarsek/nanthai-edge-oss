import type { MutationCtx } from "../_generated/server";
import { failPresentationRunState } from "./generation_fanout_cleanup";
import type { WorkflowBaseArgs } from "./workflow_mutation_handlers";

const TIMEOUT_ERROR = "Presentation generation timed out. Try again.";

export async function expireWorkflowHandler(
  ctx: MutationCtx,
  args: WorkflowBaseArgs,
): Promise<boolean> {
  const project = await ctx.db.get("presentationProjects", args.projectId);
  if (
    !project ||
    project.userId !== args.userId ||
    project.revision !== args.expectedRevision ||
    (project.status !== "planning" && project.status !== "generating")
  ) {
    return false;
  }
  const now = Date.now();
  if (project.status === "generating") {
    const run = await ctx.db.query("presentationGenerationRuns")
      .withIndex("by_project_revision", (query) =>
        query.eq("projectId", project._id).eq("projectRevision", project.revision)
      ).first();
    if (run && run.status !== "complete" && run.status !== "failed") {
      await failPresentationRunState(ctx, run, TIMEOUT_ERROR, now);
    }
  }
  await ctx.db.patch("presentationProjects", project._id, {
    status: "failed",
    workflowPhase: "failed",
    error: TIMEOUT_ERROR,
    revision: project.revision + 1,
    updatedAt: now,
  });
  return true;
}
