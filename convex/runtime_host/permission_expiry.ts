import { cancelExecutionForGenerationJob } from "../execution/cancellation";
import { finalizeGenerationHandler } from "../chat/mutations_internal_handlers";
import {
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { transitionRuntimeCommand } from "../execution/commands";

type ExpirePermissionArgs = {
  requestId: Id<"runtimePermissionRequests">;
  expectedExpiresAt: number;
};

export const expireRuntimePermissionRef = makeFunctionReference<
  "mutation",
  ExpirePermissionArgs,
  boolean
>("runtime_host/permission_expiry:expire") as unknown as FunctionReference<
  "mutation",
  "internal",
  ExpirePermissionArgs,
  boolean
>;

export async function scheduleRuntimePermissionExpiry(
  ctx: Pick<MutationCtx, "scheduler">,
  requestId: Id<"runtimePermissionRequests">,
  expiresAt: number,
): Promise<void> {
  await ctx.scheduler.runAt(expiresAt, expireRuntimePermissionRef, {
    requestId,
    expectedExpiresAt: expiresAt,
  });
}

export async function expireRuntimePermissionHandler(
  ctx: MutationCtx,
  args: ExpirePermissionArgs & { now?: number },
): Promise<boolean> {
  const request = await ctx.db.get(args.requestId);
  const now = args.now ?? Date.now();
  if (
    !request
    || request.expiresAt !== args.expectedExpiresAt
    || request.expiresAt > now
    || request.status === "resolved"
    || request.status === "closed"
    || request.status === "expired"
  ) return false;

  if (request.status === "responding" && request.responseCommandRecordId) {
    const command = await ctx.db.get(request.responseCommandRecordId);
    if (command?.status === "acknowledged" || command?.status === "completed") {
      return false;
    }
    if (command?.status === "pending") {
      await transitionRuntimeCommand(ctx, command, { status: "expired", now });
    }
  }
  await ctx.db.patch(request._id, { status: "expired", updatedAt: now });
  const job = request.generationJobId ? await ctx.db.get(request.generationJobId) : null;
  const run = await ctx.db.get(request.runId);
  // Only the scheduled generation owner is stopped; interactive/native helper expiry is unchanged.
  if (job?.sourceExecutionId && run?.generationJobId === job._id && run.activeAttemptId === request.attemptId
    && job.executionFence === request.fence && ["queued", "streaming"].includes(job.status)) {
    const error = "Scheduled local runtime permission request was unanswered for 15 minutes.";
    await cancelExecutionForGenerationJob(ctx, { jobId: job._id, requestedBy: "scheduled-permission-timeout", now });
    await finalizeGenerationHandler(ctx, { messageId: job.messageId, jobId: job._id,
      chatId: job.chatId, content: `Error: ${error}`, status: "failed", error,
      userId: job.userId, skipExecutionTerminalization: true });
  }
  return true;
}

export const expire = internalMutation({
  args: {
    requestId: v.id("runtimePermissionRequests"),
    expectedExpiresAt: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => await expireRuntimePermissionHandler(ctx, args),
});
