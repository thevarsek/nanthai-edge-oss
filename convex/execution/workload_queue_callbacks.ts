import { v } from "convex/values";
import type { DataModel } from "../_generated/dataModel";
import { terminalizeExecutionComponentByOperation } from "./component_refs";
import { backgroundWorkpool, maintenanceWorkpool } from "./components";
import { terminalizeExecution } from "./control_plane";

const backgroundCompletionContext = v.object({
  runId: v.optional(v.id("executionRuns")),
});

export const reconcileBackgroundWork = backgroundWorkpool.defineOnComplete<
  DataModel,
  typeof backgroundCompletionContext
>({
  context: backgroundCompletionContext,
  handler: async (ctx, args) => {
    await terminalizeExecutionComponentByOperation(
      ctx,
      "background-workpool",
      String(args.workId),
      args.result.kind === "success"
        ? "completed"
        : args.result.kind === "canceled" ? "cancelled" : "failed",
    );
  },
});

const maintenanceCompletionContext = v.object({ runId: v.id("executionRuns") });

export const reconcileMaintenanceWork = maintenanceWorkpool.defineOnComplete<
  DataModel,
  typeof maintenanceCompletionContext
>({
  context: maintenanceCompletionContext,
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.context.runId);
    const attempt = run?.activeAttemptId ? await ctx.db.get(run.activeAttemptId) : null;
    if (run && attempt && !["completed", "failed", "cancelled"].includes(run.state)) {
      let outcome: "completed" | "failed" | "cancelled" = args.result.kind === "success"
        ? "completed"
        : args.result.kind === "canceled" ? "cancelled" : "failed";
      const tombstone = await ctx.db.query("accountDeletionTombstones")
        .withIndex("by_user", (query) => query.eq("userId", run.userId))
        .unique();
      if (tombstone || run.state === "cancelling") outcome = "cancelled";
      await terminalizeExecution(ctx, {
        attemptId: attempt._id,
        fence: attempt.fence,
        outcome,
        summary: `Maintenance work ${outcome}`,
        allowExpiredLease: true,
      });
    }
    await terminalizeExecutionComponentByOperation(
      ctx,
      "maintenance-workpool",
      String(args.workId),
      args.result.kind === "success"
        ? "completed"
        : args.result.kind === "canceled" ? "cancelled" : "failed",
    );
  },
});
