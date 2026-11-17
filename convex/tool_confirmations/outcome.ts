import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { completeDeferredToolHandler } from "../chat/workflow_resume_handlers";
import { confirmationOutcomeResult } from "./outcome_text";

/** Single-use approval grant lifetime after the user approves. */
export const TOOL_CONFIRMATION_GRANT_TTL_MS = 15 * 60 * 1_000;
const DEFAULT_TIMEOUT_MINUTES = 15;

/**
 * Confirmation timeout. Reuses the Runtime Host question timeout preference;
 * "Never" (0) is not honoured here because an unanswered confirmation must
 * become a deny so older clients that cannot render it never hang a turn.
 */
export function toolConfirmationTimeoutMs(preference?: 0 | 5 | 10 | 15): number {
  const minutes = preference === 5 || preference === 10 || preference === 15
    ? preference
    : DEFAULT_TIMEOUT_MINUTES;
  return minutes * 60 * 1_000;
}

/**
 * Deliver a decided confirmation to the waiting generation Workflow. Delivery
 * requires the bound checkpoint to still own this confirmation; the deferred
 * tool completion itself rechecks job, attempt, fence and resume event.
 */
export async function deliverToolConfirmationOutcome(
  ctx: MutationCtx,
  request: Doc<"toolConfirmationRequests">,
  now = Date.now(),
): Promise<boolean> {
  if (!request.checkpointBound || request.deliveredAt !== undefined) return false;
  if (request.status !== "approved" && request.status !== "denied" && request.status !== "expired") {
    return false;
  }
  const continuation = await ctx.db
    .query("generationContinuations")
    .withIndex("by_job", (q) => q.eq("jobId", request.generationJobId))
    .first();
  const ownership = continuation?.deferredOwnership;
  if (
    !continuation
    || !continuation.deferredResumeEventId
    || ownership?.kind !== "tool_confirmation"
    || ownership.confirmationId !== request._id
    || ownership.toolCallId !== request.toolCallId
  ) return false;
  const outcome = confirmationOutcomeResult(request);
  const delivered = await completeDeferredToolHandler(ctx, {
    jobId: request.generationJobId,
    userId: request.userId,
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    result: outcome.result,
    ...(outcome.isError ? { isError: true } : {}),
    eventId: continuation.deferredResumeEventId,
  });
  if (delivered === "resumed" || delivered === "duplicate") {
    await ctx.db.patch(request._id, { deliveredAt: now, updatedAt: now });
    return true;
  }
  return false;
}
