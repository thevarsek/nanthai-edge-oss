import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "../_generated/server";
import { TERMINAL_GENERATION_JOB_STATUSES } from "../chat/generation_continuation_shared";
import {
  saveGenerationContinuationHandler,
  type SaveGenerationContinuationArgs,
} from "../chat/mutations_generation_continuation_handlers";
import { saveGenerationContinuationArgs } from "../chat/mutations_args";
import { requireAuth } from "../lib/auth";
import { deliverToolConfirmationOutcome, TOOL_CONFIRMATION_GRANT_TTL_MS } from "./outcome";
import {
  toolConfirmationDecision,
  toolConfirmationStatus,
  type ToolConfirmationDecision,
  type ToolConfirmationStatus,
} from "./validators";

/** True when the owning generation can still accept this confirmation. */
async function ownerIsCurrent(ctx: MutationCtx, request: Doc<"toolConfirmationRequests">): Promise<boolean> {
  const job = await ctx.db.get(request.generationJobId);
  return job !== null
    && job.userId === request.userId
    && !TERMINAL_GENERATION_JOB_STATUSES.has(job.status)
    && job.executionAttemptId === request.attemptId
    && job.executionFence === request.fence;
}

async function closeRequest(ctx: MutationCtx, request: Doc<"toolConfirmationRequests">, now: number) {
  await ctx.db.patch(request._id, {
    status: "closed",
    decisionSource: "system",
    decidedAt: now,
    updatedAt: now,
  });
}

export async function respondToToolConfirmationHandler(
  ctx: MutationCtx,
  args: { userId: string; confirmationId: Id<"toolConfirmationRequests">; decision: ToolConfirmationDecision },
  now = Date.now(),
): Promise<{ status: ToolConfirmationStatus }> {
  const request = await ctx.db.get(args.confirmationId);
  if (!request || request.userId !== args.userId) {
    throw new ConvexError({ code: "NOT_FOUND" as const, message: "Confirmation request not found" });
  }
  const requested = args.decision === "approve" ? "approved" : "denied";
  if (request.status !== "pending") {
    if (request.status === requested) return { status: request.status };
    throw new ConvexError({
      code: request.status === "expired" ? "TOOL_CONFIRMATION_EXPIRED" as const : "CONFLICT" as const,
      message: request.status === "expired"
        ? "This confirmation timed out and was treated as declined"
        : "This confirmation is no longer waiting for a response",
    });
  }
  if (!await ownerIsCurrent(ctx, request)) {
    await closeRequest(ctx, request, now);
    return { status: "closed" };
  }
  if (now >= request.expiresAt) {
    await ctx.db.patch(request._id, { status: "expired", decisionSource: "timeout", decidedAt: now, updatedAt: now });
    const expired = await ctx.db.get(request._id);
    if (expired) await deliverToolConfirmationOutcome(ctx, expired, now);
    return { status: "expired" };
  }
  await ctx.db.patch(request._id, {
    status: requested,
    decisionSource: "user",
    decidedAt: now,
    ...(requested === "approved" ? { grantExpiresAt: now + TOOL_CONFIRMATION_GRANT_TTL_MS } : {}),
    updatedAt: now,
  });
  const decided = await ctx.db.get(request._id);
  if (decided) await deliverToolConfirmationOutcome(ctx, decided, now);
  return { status: requested };
}

export const respond = mutation({
  args: {
    confirmationId: v.id("toolConfirmationRequests"),
    decision: toolConfirmationDecision,
  },
  returns: v.object({ status: toolConfirmationStatus }),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    return await respondToToolConfirmationHandler(ctx, { userId, ...args });
  },
});

export async function expireToolConfirmationHandler(
  ctx: MutationCtx,
  args: { confirmationId: Id<"toolConfirmationRequests"> },
  now = Date.now(),
): Promise<ToolConfirmationStatus | null> {
  const request = await ctx.db.get(args.confirmationId);
  if (!request) return null;
  if (request.status !== "pending") {
    // A decision that raced checkpoint binding is delivered by the binder.
    return request.status;
  }
  if (!await ownerIsCurrent(ctx, request)) {
    await closeRequest(ctx, request, now);
    return "closed";
  }
  await ctx.db.patch(request._id, { status: "expired", decisionSource: "timeout", decidedAt: now, updatedAt: now });
  const expired = await ctx.db.get(request._id);
  if (expired) await deliverToolConfirmationOutcome(ctx, expired, now);
  return "expired";
}

export const expire = internalMutation({
  args: { confirmationId: v.id("toolConfirmationRequests") },
  returns: v.union(toolConfirmationStatus, v.null()),
  handler: async (ctx, args) => await expireToolConfirmationHandler(ctx, args),
});

/** Re-attempt delivery after a successor Workflow rebinds the resume event. */
export const redeliver = internalMutation({
  args: { confirmationId: v.id("toolConfirmationRequests") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.confirmationId);
    if (!request) return false;
    return await deliverToolConfirmationOutcome(ctx, request);
  },
});

export async function bindToolConfirmationCheckpointHandler(
  ctx: MutationCtx,
  args: SaveGenerationContinuationArgs & {
    confirmationId: Id<"toolConfirmationRequests">;
    toolCallId: string;
  },
  now = Date.now(),
): Promise<null> {
  const request = await ctx.db.get(args.confirmationId);
  if (
    !request
    || request.userId !== args.userId
    || request.generationJobId !== args.jobId
    || request.toolCallId !== args.toolCallId
  ) throw new Error("TOOL_CONFIRMATION_OWNERSHIP_MISMATCH");
  const ownership = args.checkpoint.deferredOwnership;
  if (ownership?.kind !== "tool_confirmation" || ownership.confirmationId !== request._id) {
    throw new Error("TOOL_CONFIRMATION_CHECKPOINT_MISMATCH");
  }
  await saveGenerationContinuationHandler(ctx, {
    chatId: args.chatId,
    messageId: args.messageId,
    jobId: args.jobId,
    userId: args.userId,
    checkpoint: args.checkpoint,
  });
  await ctx.db.patch(request._id, { checkpointBound: true, updatedAt: now });
  if (request.status !== "pending") {
    const bound = await ctx.db.get(request._id);
    if (bound) await deliverToolConfirmationOutcome(ctx, bound, now);
  }
  return null;
}

export const bindCheckpoint = internalMutation({
  args: {
    ...saveGenerationContinuationArgs,
    confirmationId: v.id("toolConfirmationRequests"),
    toolCallId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => await bindToolConfirmationCheckpointHandler(
    ctx,
    args as SaveGenerationContinuationArgs & {
      confirmationId: Id<"toolConfirmationRequests">;
      toolCallId: string;
    },
  ),
});
