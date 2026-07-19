import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export type PresentationWorkOutcome = "completed" | "failed" | null;

type PresentationWorkRole =
  | { kind: "studio"; batchIndex: number }
  | { kind: "curator" }
  | { kind: "curator_task"; taskKey: string }
  | { kind: "finalizer" }
  | { kind: "unknown" };

function numericPrefix(value: string): number | null {
  const segment = value.split(":", 1)[0];
  if (!segment || !/^(0|[1-9][0-9]*)$/.test(segment)) return null;
  const parsed = Number(segment);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function valueWithoutNumericSuffix(value: string): string | null {
  const separator = value.lastIndexOf(":");
  if (separator <= 0 || !/^(0|[1-9][0-9]*)$/.test(value.slice(separator + 1))) {
    return null;
  }
  return value.slice(0, separator);
}

function presentationWorkRole(role: string | undefined): PresentationWorkRole {
  if (!role) return { kind: "unknown" };
  if (role === "presentation-curator") return { kind: "curator" };
  if (role.startsWith("presentation-curator-recovery:")) {
    return { kind: "curator" };
  }
  if (role === "presentation-finalizer") return { kind: "finalizer" };
  if (role.startsWith("presentation-finalizer-recovery:")) {
    return { kind: "finalizer" };
  }

  const curatorTaskPrefix = "presentation-curator-task:";
  if (role.startsWith(curatorTaskPrefix)) {
    return { kind: "curator_task", taskKey: role.slice(curatorTaskPrefix.length) };
  }
  for (const prefix of [
    "presentation-curator-retry:",
    "presentation-curator-task-recovery:",
  ]) {
    if (!role.startsWith(prefix)) continue;
    const taskKey = valueWithoutNumericSuffix(role.slice(prefix.length));
    return taskKey ? { kind: "curator_task", taskKey } : { kind: "unknown" };
  }

  for (const prefix of [
    "presentation-studio-repair:",
    "presentation-studio-recovery:",
  ]) {
    if (!role.startsWith(prefix)) continue;
    const batchIndex = numericPrefix(role.slice(prefix.length));
    return batchIndex === null
      ? { kind: "unknown" }
      : { kind: "studio", batchIndex };
  }
  const studioPrefix = "presentation-studio:";
  if (role.startsWith(studioPrefix)) {
    const batchIndex = numericPrefix(role.slice(studioPrefix.length));
    return batchIndex === null
      ? { kind: "unknown" }
      : { kind: "studio", batchIndex };
  }
  return { kind: "unknown" };
}

export async function derivePresentationWorkOutcome(
  ctx: MutationCtx,
  operationId: string,
  runId: Id<"presentationGenerationRuns">,
): Promise<PresentationWorkOutcome> {
  const [run, batch, task, component] = await Promise.all([
    ctx.db.get(runId),
    ctx.db.query("presentationGenerationBatches")
      .withIndex("by_workpool_operation", (query) =>
        query.eq("workpoolOperationId", operationId),
      )
      .unique(),
    ctx.db.query("presentationCuratorTasks")
      .withIndex("by_workpool_operation", (query) =>
        query.eq("workpoolOperationId", operationId),
      )
      .unique(),
    ctx.db.query("executionComponentRefs")
      .withIndex("by_operation", (query) => query
        .eq("adapterId", "interactive-workpool")
        .eq("operationId", operationId))
      .unique(),
  ]);
  if (!run) return "completed";
  if (run.status === "complete") return "completed";
  if (run.status === "failed") return "failed";
  if (batch) {
    if (batch.status === "complete") return "completed";
    if (batch.status === "failed") return "failed";
    return null;
  }
  if (task) return task.status === "complete" ? "completed" : null;

  if (!component || component.runId !== run.executionRunId) return null;
  const role = presentationWorkRole(component.role);
  if (role.kind === "studio") {
    const batches = await ctx.db.query("presentationGenerationBatches")
      .withIndex("by_run", (query) => query.eq("runId", run._id))
      .collect();
    const ownedBatch = batches.find((candidate) =>
      candidate.batchIndex === role.batchIndex
    );
    if (!ownedBatch) return null;
    if (ownedBatch.status === "complete") return "completed";
    if (ownedBatch.status === "failed") return "failed";
    return ownedBatch.workpoolOperationId !== operationId ? "completed" : null;
  }
  if (role.kind === "curator_task") {
    const tasks = await ctx.db.query("presentationCuratorTasks")
      .withIndex("by_run", (query) => query.eq("runId", run._id))
      .collect();
    const ownedTask = tasks.find((candidate) =>
      candidate.taskKey === role.taskKey
    );
    if (!ownedTask) return null;
    if (ownedTask.status === "complete") return "completed";
    return ownedTask.workpoolOperationId !== operationId ? "completed" : null;
  }
  if (role.kind === "curator") {
    if (run.curatorWorkpoolOperationId !== operationId) return "completed";
    if (run.status === "finalizing") return "completed";
    if (run.status === "curating") {
      const task = await ctx.db.query("presentationCuratorTasks")
        .withIndex("by_run", (query) => query.eq("runId", run._id))
        .first();
      if (task) return "completed";
    }
    return null;
  }
  if (role.kind === "finalizer") {
    return run.finalizerWorkpoolOperationId !== operationId ? "completed" : null;
  }
  return null;
}
