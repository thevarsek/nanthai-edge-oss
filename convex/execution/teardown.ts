import { internalAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
  advanceRunTreeTeardown,
  finalizeRunCancellationIfSettled,
} from "./teardown_graph";
import {
  cancelComponent,
  cancelOwnedComponents,
} from "./teardown_components";
import {
  cancelChatExecutionsAndDeleteHandler,
  cancelUserExecutionsHandler,
} from "./teardown_delete_handlers";

const ownedComponent = v.object({
  componentRefId: v.optional(v.id("executionComponentRefs")),
  operationId: v.string(),
  adapterId: v.string(),
  cancelSafeAfter: v.optional(v.number()),
});
const teardownAdvance = v.object({
  components: v.array(ownedComponent),
  done: v.boolean(),
});

const ACTION_DRAIN_GRACE_MS = 11 * 60 * 1_000;
const UNACKNOWLEDGED_CANCEL_RETRY_MS = 1_000;
const EXTERNAL_CANCEL_RETRY_MS = 30_000;

function requiresActionDrain(adapterId: string): boolean {
  return adapterId === "convex-workflow"
    || adapterId === "interactive-workpool"
    || adapterId === "background-workpool"
    || adapterId === "maintenance-workpool";
}

export function cancelRunTreeRetryDelay(
  components: Array<{ adapterId: string; cancelSafeAfter?: number }>,
  confirmed: boolean,
  now: number,
): number {
  const hasExternal = components.some((component) => component.adapterId === "external-cloud");
  const acknowledgedDrain = confirmed && components.some((component) =>
    requiresActionDrain(component.adapterId)
  );
  const knownSafeAfter = components.reduce<number | undefined>(
    (latest, component) => component.cancelSafeAfter === undefined
      ? latest
      : Math.max(latest ?? 0, component.cancelSafeAfter),
    undefined,
  );
  if (acknowledgedDrain) {
    return Math.max(1, (knownSafeAfter ?? now + ACTION_DRAIN_GRACE_MS) - now);
  }
  if (!confirmed) {
    return hasExternal ? EXTERNAL_CANCEL_RETRY_MS : UNACKNOWLEDGED_CANCEL_RETRY_MS;
  }
  return 0;
}

export function isComponentCancellationConfirmed(
  cancelRequestSucceeded: boolean,
  cancelAcknowledgedAt: number | undefined,
): boolean {
  return cancelRequestSucceeded || cancelAcknowledgedAt !== undefined;
}

export const requestRunTeardown = internalMutation({
  args: {
    runId: v.id("executionRuns"),
    requestedBy: v.string(),
    reason: v.string(),
  },
  returns: teardownAdvance,
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return { components: [], done: true };
    return await advanceRunTreeTeardown(
      ctx,
      run,
      args.requestedBy,
      args.reason,
    );
  },
});

export const finishComponentCancellation = internalMutation({
  args: {
    componentRefId: v.id("executionComponentRefs"),
    cancelled: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ref = await ctx.db.get(args.componentRefId);
    if (!ref || ref.status !== "cancel_requested") return null;
    const now = Date.now();
    if (!args.cancelled) {
      await ctx.db.patch(ref._id, { updatedAt: now });
      return null;
    }
    if (requiresActionDrain(ref.adapterId)) {
      await ctx.db.patch(ref._id, {
        cancelSafeAfter: ref.cancelSafeAfter ?? now + ACTION_DRAIN_GRACE_MS,
        updatedAt: now,
      });
      return null;
    }
    await ctx.db.patch(ref._id, {
      status: "cancelled",
      terminalAt: now,
      updatedAt: now,
    });
    await finalizeRunCancellationIfSettled(ctx, ref.runId, now);
    return null;
  },
});

export const reconcilePendingComponentCancellations = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    const pending = await ctx.db
      .query("executionComponentRefs")
      .withIndex("by_status_updated", (q) => q.eq("status", "cancel_requested"))
      .take(50);
    for (const ref of pending) {
      const now = Date.now();
      if (
        ref.adapterId === "external-cloud"
        && ref.operationId.startsWith("openrouter-video:")
      ) {
        await ctx.scheduler.runAfter(
          0,
          internal.execution.teardown.reconcileExternalComponentCancellation,
          { componentRefId: ref._id },
        );
        await ctx.db.patch(ref._id, { updatedAt: now });
        continue;
      }
      if (requiresActionDrain(ref.adapterId)) {
        const cancelSafeAfter = ref.cancelSafeAfter ?? now + ACTION_DRAIN_GRACE_MS;
        if (ref.cancelSafeAfter === undefined) {
          await ctx.db.patch(ref._id, { cancelSafeAfter, updatedAt: now });
        }
        if (cancelSafeAfter > now) continue;
      }
      const cancelled = await cancelComponent(ctx, ref.adapterId, ref.operationId);
      if (!isComponentCancellationConfirmed(cancelled, ref.cancelAcknowledgedAt)) {
        await ctx.db.patch(ref._id, { updatedAt: Date.now() });
        continue;
      }
      await ctx.db.patch(ref._id, {
        status: "cancelled",
        terminalAt: now,
        updatedAt: now,
      });
      await finalizeRunCancellationIfSettled(ctx, ref.runId, now);
    }
    return pending.length;
  },
});

export const reconcileExternalComponentCancellation = internalAction({
  args: { componentRefId: v.id("executionComponentRefs") },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const ref = await ctx.runQuery(internal.execution.queries.getComponentRefInternal, {
      componentRefId: args.componentRefId,
    });
    if (!ref || ref.status !== "cancel_requested") return true;
    const prefix = "openrouter-video:";
    if (ref.adapterId !== "external-cloud" || !ref.operationId.startsWith(prefix)) {
      return false;
    }
    const cancelled = await ctx.runAction(
      internal.chat.video_reconciliation.reconcileCancelledProvider,
      { videoJobId: ref.operationId.slice(prefix.length) as Id<"videoJobs"> },
    );
    await ctx.runMutation(internal.execution.teardown.finishComponentCancellation, {
      componentRefId: ref._id,
      cancelled,
    });
    return cancelled;
  },
});

export const cancelRunTree = internalAction({
  args: {
    runId: v.id("executionRuns"),
    requestedBy: v.string(),
    reason: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const advanced: {
      components: Array<{
      componentRefId?: Id<"executionComponentRefs">;
      operationId: string;
      adapterId: string;
      cancelSafeAfter?: number;
      }>;
      done: boolean;
    } = await ctx.runMutation(
      internal.execution.teardown.requestRunTeardown,
      args,
    );
    const confirmed = await cancelOwnedComponents(ctx, advanced.components);
    if (!advanced.done || !confirmed) {
      const delayMs = cancelRunTreeRetryDelay(
        advanced.components,
        confirmed,
        Date.now(),
      );
      await ctx.scheduler.runAfter(delayMs, internal.execution.teardown.cancelRunTree, args);
    }
    return advanced.done && confirmed;
  },
});

export const cancelScheduledJobAndDelete = internalAction({
  args: { jobId: v.id("scheduledJobs"), userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(internal.scheduledJobs.queries.getJobInternal, {
      jobId: args.jobId,
    });
    if (!job || job.userId !== args.userId) return null;
    if (job.executionRunId) {
      const advanced: {
        components: Array<{
          componentRefId?: Id<"executionComponentRefs">;
          operationId: string;
          adapterId: string;
        }>;
        done: boolean;
      } = await ctx.runMutation(
        internal.execution.teardown.requestRunTeardown,
        {
          runId: job.executionRunId,
          requestedBy: args.userId,
          reason: "Scheduled job deleted",
        },
      );
      const confirmed = await cancelOwnedComponents(ctx, advanced.components);
      if (!advanced.done || !confirmed) {
        await ctx.scheduler.runAfter(
          5_000,
          internal.execution.teardown.cancelScheduledJobAndDelete,
          args,
        );
        return null;
      }
    }
    if (job.activeGenerationJobId) {
      const generationJob = await ctx.runQuery(
        internal.chat.queries.getGenerationJobInternal,
        { jobId: job.activeGenerationJobId },
      );
      if (
        generationJob?.executionRunId
        && generationJob.executionRunId !== job.executionRunId
      ) {
        const advanced: {
          components: Array<{
            componentRefId?: Id<"executionComponentRefs">;
            operationId: string;
            adapterId: string;
          }>;
          done: boolean;
        } = await ctx.runMutation(
          internal.execution.teardown.requestRunTeardown,
          {
            runId: generationJob.executionRunId,
            requestedBy: args.userId,
            reason: "Scheduled job deleted",
          },
        );
        const confirmed = await cancelOwnedComponents(ctx, advanced.components);
        if (!advanced.done || !confirmed) {
          await ctx.scheduler.runAfter(
            5_000,
            internal.execution.teardown.cancelScheduledJobAndDelete,
            args,
          );
          return null;
        }
      }
    }
    const deleted = await ctx.runMutation(
      internal.scheduledJobs.mutations.deleteJobBatchInternal,
      args,
    );
    if (!deleted) {
      await ctx.scheduler.runAfter(
        0,
        internal.execution.teardown.cancelScheduledJobAndDelete,
        args,
      );
    }
    return null;
  },
});

export const cancelUserExecutions = internalAction({
  args: { userId: v.string(), reason: v.string() },
  returns: v.boolean(),
  handler: cancelUserExecutionsHandler,
});

export const cancelChatExecutionsAndDelete = internalAction({
  args: { chatId: v.id("chats"), userId: v.string() },
  returns: v.null(),
  handler: cancelChatExecutionsAndDeleteHandler,
});
