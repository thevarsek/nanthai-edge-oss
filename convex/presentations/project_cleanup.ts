import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { storageHasContentReferences } from "../knowledge_base/delete_helpers";

/** Delete one presentation project and every private orchestration child row. */
export async function deletePresentationProjectData(
  ctx: MutationCtx,
  project: Doc<"presentationProjects">,
): Promise<void> {
  const [slides, assets, generatedFiles, generationRuns] = await Promise.all([
    ctx.db
      .query("presentationSlides")
      .withIndex("by_project", (query) => query.eq("projectId", project._id))
      .collect(),
    ctx.db
      .query("presentationAssets")
      .withIndex("by_project", (query) => query.eq("projectId", project._id))
      .collect(),
    ctx.db
      .query("generatedFiles")
      .withIndex("by_presentation_project", (query) =>
        query.eq("presentationProjectId", project._id)
      )
      .collect(),
    ctx.db
      .query("presentationGenerationRuns")
      .withIndex("by_project_revision", (query) => query.eq("projectId", project._id))
      .collect(),
  ]);

  for (const run of generationRuns) {
    const [batches, candidates, tasks] = await Promise.all([
      ctx.db.query("presentationGenerationBatches")
        .withIndex("by_run", (query) => query.eq("runId", run._id)).collect(),
      ctx.db.query("presentationSlideCandidates")
        .withIndex("by_run", (query) => query.eq("runId", run._id)).collect(),
      ctx.db.query("presentationCuratorTasks")
        .withIndex("by_run", (query) => query.eq("runId", run._id)).collect(),
    ]);
    for (const batch of batches) {
      if (batch.candidateStorageId) {
        await ctx.storage.delete(batch.candidateStorageId).catch(() => undefined);
      }
      await ctx.db.delete(batch._id);
    }
    await Promise.all(candidates.map((candidate) => ctx.db.delete(candidate._id)));
    await Promise.all(tasks.map((task) => ctx.db.delete(task._id)));
    await ctx.db.delete(run._id);
  }

  await Promise.all(slides.map((slide) => ctx.db.delete(slide._id)));
  for (const asset of assets) {
    await ctx.db.delete(asset._id);
    if (!await storageHasContentReferences(ctx, asset.storageId)) {
      await ctx.storage.delete(asset.storageId).catch(() => undefined);
    }
  }
  if (project.snapshotStorageId && generatedFiles.length === 0) {
    await ctx.storage.delete(project.snapshotStorageId).catch(() => undefined);
  }
  await ctx.db.delete(project._id);
}
