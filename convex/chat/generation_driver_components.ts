import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

const GENERATION_DRIVER_EXACT_ROLES = new Set([
  "generation-workflow",
  "generation-workflow-primary",
  "video-generation-workflow",
]);

export function isGenerationDriverRole(role: string): boolean {
  return GENERATION_DRIVER_EXACT_ROLES.has(role)
    || role.startsWith("generation-workflow-continuation:")
    || role.startsWith("generation-workflow-recovery:");
}

export async function findActiveGenerationDriver(
  ctx: Pick<MutationCtx, "db">,
  runId: Id<"executionRuns">,
): Promise<Doc<"executionComponentRefs"> | null> {
  for (const status of ["active", "cancel_requested"] as const) {
    const refs = await ctx.db
      .query("executionComponentRefs")
      .withIndex("by_run_status", (query) => query.eq("runId", runId).eq("status", status))
      .collect();
    const driver = refs.find((ref) => isGenerationDriverRole(ref.role));
    if (driver) return driver;
  }
  return null;
}
