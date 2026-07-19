import { v } from "convex/values";
import type { QueryCtx } from "../_generated/server";

// Keep the whole cross-domain proof below Convex's per-query document budget.
// Any source with more active rows than this fails closed as incomplete.
export const LEGACY_DRAIN_SOURCE_SAMPLE_LIMIT = 50;

export const legacyDrainSourceValidator = v.object({
  source: v.string(),
  sampledActiveLegacy: v.number(),
  sampleCapped: v.boolean(),
});

export const legacyDrainStateValidator = v.object({
  hasActiveLegacy: v.boolean(),
  sampledActiveLegacy: v.number(),
  sampleCapped: v.boolean(),
  inspectionComplete: v.boolean(),
  drainComplete: v.boolean(),
  sources: v.array(legacyDrainSourceValidator),
});

type SampleRow = Record<string, unknown>;
type Loader = () => Promise<unknown[]>;

interface SourceSample {
  source: string;
  sampledActiveLegacy: number;
  sampleCapped: boolean;
}

async function inspectSource(
  source: string,
  loaders: Loader[],
  isLegacy: (row: SampleRow) => boolean,
): Promise<SourceSample> {
  let sampledActiveLegacy = 0;
  let sampleCapped = false;
  for (const load of loaders) {
    const page = await load();
    if (page.length > LEGACY_DRAIN_SOURCE_SAMPLE_LIMIT) sampleCapped = true;
    sampledActiveLegacy += page
      .slice(0, LEGACY_DRAIN_SOURCE_SAMPLE_LIMIT)
      .filter((row): row is SampleRow => typeof row === "object" && row !== null)
      .filter(isLegacy).length;
  }
  return { source, sampledActiveLegacy, sampleCapped };
}

function statusLoaders<T extends string>(
  statuses: readonly T[],
  load: (status: T) => Promise<unknown[]>,
): Loader[] {
  return statuses.map((status) => () => load(status));
}

export async function inspectLegacyOrchestrationDrain(ctx: QueryCtx) {
  const take = LEGACY_DRAIN_SOURCE_SAMPLE_LIMIT + 1;
  const sources = await Promise.all([
    inspectSource("executionAttempts", statusLoaders(
      ["queued", "claimed", "running", "waiting", "interrupted"] as const,
      async (status) => (await Promise.all([
        ctx.db.query("executionAttempts").withIndex("by_engine_status", (q) => q
          .eq("orchestrationEngine", "legacy_scheduler").eq("status", status)).take(take),
        ctx.db.query("executionAttempts").withIndex("by_engine_status", (q) => q
          .eq("orchestrationEngine", undefined).eq("status", status)).take(take),
      ])).flat(),
    ), () => true),
    inspectSource("generationJobs", statusLoaders(
      ["queued", "streaming"] as const,
      (status) => ctx.db.query("generationJobs")
        .withIndex("by_status", (q) => q.eq("status", status)).take(take),
    ), (row) => row.scheduledFunctionId !== undefined || row.executionAttemptId === undefined),
    inspectSource("generationContinuations", statusLoaders(
      ["waiting", "running"] as const,
      (status) => ctx.db.query("generationContinuations")
        .withIndex("by_status", (q) => q.eq("status", status)).take(take),
    ), (row) => row.scheduledFunctionId !== undefined || row.executionAttemptId === undefined),
    inspectSource("autonomousSessions", statusLoaders(
      ["running", "paused"] as const,
      (status) => ctx.db.query("autonomousSessions")
        .withIndex("by_status_updated", (q) => q.eq("status", status)).take(take),
    ), (row) => row.workflowId === undefined || row.executionAttemptId === undefined),
    inspectSource("searchSessions", statusLoaders(
      ["planning", "searching", "analyzing", "deepening", "synthesizing", "writing"] as const,
      (status) => ctx.db.query("searchSessions")
        .withIndex("by_status_started", (q) => q.eq("status", status)).take(take),
    ), (row) => row.workflowId === undefined || row.executionAttemptId === undefined),
    inspectSource("advisorBatches", statusLoaders(
      ["queued", "running", "synthesizing"] as const,
      (status) => ctx.db.query("advisorBatches")
        .withIndex("by_status", (q) => q.eq("status", status)).take(take),
    ), (row) => row.workflowId === undefined || row.executionAttemptId === undefined
      || row.scheduledFinalGenerationId !== undefined
      || (Array.isArray(row.scheduledFinalGenerationIds) && row.scheduledFinalGenerationIds.length > 0)),
    inspectSource("advisorRuns", statusLoaders(
      ["queued", "preparing_context", "consulting", "streaming"] as const,
      (status) => ctx.db.query("advisorRuns")
        .withIndex("by_status", (q) => q.eq("status", status)).take(take),
    ), (row) => row.scheduledFunctionId !== undefined
      || row.watchdogScheduledFunctionId !== undefined
      || row.workpoolOperationId === undefined),
    inspectSource("subagentBatches", statusLoaders(
      ["running_children", "waiting_to_resume", "resuming"] as const,
      (status) => ctx.db.query("subagentBatches")
        .withIndex("by_status_updated", (q) => q.eq("status", status)).take(take),
    ), (row) => row.workflowResumeEventId === undefined),
    inspectSource("subagentRuns", statusLoaders(
      ["queued", "streaming", "waiting_continuation"] as const,
      (status) => ctx.db.query("subagentRuns")
        .withIndex("by_status", (q) => q.eq("status", status)).take(take),
    ), (row) => row.workpoolOperationId === undefined && row.workflowId === undefined),
    inspectSource("drivePickerBatches", statusLoaders(
      ["awaiting_pick", "resuming"] as const,
      (status) => ctx.db.query("drivePickerBatches")
        .withIndex("by_status_updated", (q) => q.eq("status", status)).take(take),
    ), (row) => row.workflowResumeEventId === undefined),
    inspectSource("presentationProjects", statusLoaders(
      ["planning", "generating"] as const,
      (status) => ctx.db.query("presentationProjects")
        .withIndex("by_status_updated", (q) => q.eq("status", status)).take(take),
    ), (row) => row.workflowId === undefined || row.executionAttemptId === undefined),
    inspectSource("presentationGenerationRuns", statusLoaders(
      ["generating", "curator_queued", "curating", "finalizing"] as const,
      (status) => ctx.db.query("presentationGenerationRuns")
        .withIndex("by_status_updated", (q) => q.eq("status", status)).take(take),
    ), (row) => row.workflowId === undefined || row.executionAttemptId === undefined
      || row.curatorScheduledFunctionId !== undefined
      || row.finalizerScheduledFunctionId !== undefined
      || row.snapshotScheduledFunctionId !== undefined),
    inspectSource("presentationGenerationBatches", statusLoaders(
      ["queued", "running", "repairing"] as const,
      (status) => ctx.db.query("presentationGenerationBatches")
        .withIndex("by_status_updated", (q) => q.eq("status", status)).take(take),
    ), (row) => row.scheduledFunctionId !== undefined || row.workpoolOperationId === undefined),
    inspectSource("presentationCuratorTasks", statusLoaders(
      ["queued", "running"] as const,
      (status) => ctx.db.query("presentationCuratorTasks")
        .withIndex("by_status_updated", (q) => q.eq("status", status)).take(take),
    ), (row) => row.scheduledFunctionId !== undefined || row.workpoolOperationId === undefined),
    inspectSource("researchSearchBatches", statusLoaders(
      ["queued", "running"] as const,
      (status) => ctx.db.query("researchSearchBatches")
        .withIndex("by_status_updated", (q) => q.eq("status", status)).take(take),
    ), (row) => !Array.isArray(row.workpoolOperationIds) || row.workpoolOperationIds.length === 0),
    inspectSource("researchSearchTasks", statusLoaders(
      ["queued"] as const,
      (status) => ctx.db.query("researchSearchTasks")
        .withIndex("by_status_updated", (q) => q.eq("status", status)).take(take),
    ), (row) => row.workpoolOperationId === undefined),
    inspectSource("scheduledJobs", [() => ctx.db.query("scheduledJobs")
      .withIndex("by_active_execution", (q) => q.gt("activeExecutionId", ""))
      .take(take)], (row) => row.activeWorkflowId === undefined || row.executionAttemptId === undefined),
    inspectSource("videoJobs", statusLoaders(
      ["pending", "in_progress"] as const,
      (status) => ctx.db.query("videoJobs")
        .withIndex("by_status_createdAt", (q) => q.eq("status", status)).take(take),
    ), (row) => row.executionAttemptId === undefined),
  ]);
  const sampledActiveLegacy = sources.reduce(
    (total, source) => total + source.sampledActiveLegacy,
    0,
  );
  const sampleCapped = sources.some((source) => source.sampleCapped);
  return {
    hasActiveLegacy: sampledActiveLegacy > 0,
    sampledActiveLegacy,
    sampleCapped,
    inspectionComplete: !sampleCapped,
    drainComplete: sampledActiveLegacy === 0 && !sampleCapped,
    sources,
  };
}
