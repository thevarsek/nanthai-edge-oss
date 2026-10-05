import { notifyRuntimeRequest } from "./request_notifications";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { RuntimeRequestEventContext } from "./request_event_context";
import type { NonTerminalAdapterEvent } from "./protocol_adapter_events";
import { scheduleRuntimePermissionExpiry } from "./permission_expiry";

type RequestedEvent = Extract<
  NonTerminalAdapterEvent,
  { type: "permission_requested" }
>;
type ResolvedEvent = Extract<
  NonTerminalAdapterEvent,
  { type: "permission_resolved" }
>;
type PermissionRequest = Doc<"runtimePermissionRequests">;

const OUTSTANDING_STATUSES = ["pending", "responding", "expired"] as const;
const CLOSE_BATCH_SIZE = 40;

export async function recordRuntimePermissionRequested(
  ctx: MutationCtx,
  context: RuntimeRequestEventContext,
  event: RequestedEvent,
): Promise<Id<"runtimePermissionRequests">> {
  if (context.attempt.status !== "running") {
    throw permissionError(
      "RUNTIME_PERMISSION_ATTEMPT_INACTIVE",
      "Runtime permission request does not belong to a live worker attempt",
    );
  }
  const existing = await requestsForNativeId(
    ctx,
    context.attempt._id,
    event.permissionRequestId,
  );
  const exact = existing.find((request) => request.requestEventId === event.eventId);
  if (exact) return exact._id;
  if (existing.some((request) => isOutstanding(request.status))) {
    throw permissionError(
      "RUNTIME_PERMISSION_REQUEST_CONFLICT",
      "Runtime worker reused an active permission request ID",
    );
  }

  const now = Date.now();
  const expiresAt = context.job.sourceExecutionId
    ? Math.min(event.expiresAt ?? Infinity, now + 15 * 60_000) : event.expiresAt;
  const requestId = await ctx.db.insert("runtimePermissionRequests", {
    userId: context.run.userId,
    chatId: context.job.chatId,
    generationJobId: context.job._id,
    runId: context.run._id,
    attemptId: context.attempt._id,
    fence: context.attempt.fence,
    primaryCommandRecordId: context.command._id,
    requestEventId: event.eventId,
    requestEventSequence: event.sequence,
    permissionRequestId: event.permissionRequestId,
    nativeAgentThreadId: event.nativeAgentThreadId ?? undefined,
    toolCallId: event.toolCallId ?? undefined,
    permissionKind: event.permissionKind,
    prompt: event.prompt,
    choices: event.choices,
    expiresAt: expiresAt ?? undefined,
    status: !context.job.sourceExecutionId && expiresAt !== null && expiresAt <= now
      ? "expired"
      : "pending",
    createdAt: now,
    updatedAt: now,
  });
  if (context.run.state !== "waiting_for_permission") {
    await ctx.db.patch(context.run._id, {
      state: "waiting_for_permission",
      updatedAt: now,
    });
  }
  if (expiresAt !== null) await scheduleRuntimePermissionExpiry(ctx, requestId, expiresAt);
  await notifyRuntimeRequest(ctx, context.run.userId, context.job.chatId);
  return requestId;
}

export async function recordRuntimePermissionResolved(
  ctx: MutationCtx,
  context: RuntimeRequestEventContext,
  event: ResolvedEvent,
): Promise<void> {
  const requests = await requestsForNativeId(
    ctx,
    context.attempt._id,
    event.permissionRequestId,
  );
  const request = requests.find((candidate) => isOutstanding(candidate.status));
  if (request) {
    if (
      request.requestedDecision !== undefined
      && request.requestedDecision !== event.decision
    ) {
      throw permissionError(
        "RUNTIME_PERMISSION_DECISION_CONFLICT",
        "Runtime permission resolution does not match the requested decision",
      );
    }
    await assertResponseCommand(ctx, context, request, event);
    await ctx.db.patch(request._id, {
      status: "resolved",
      resolvedDecision: event.decision,
      resolvedAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  if (
    context.run.state === "waiting_for_permission"
    && !await hasOutstandingPermission(ctx, context.attempt._id)
  ) {
    await ctx.db.patch(context.run._id, { state: "running", updatedAt: Date.now() });
  }
}

export async function closeRuntimePermissionsForAttempt(
  ctx: MutationCtx,
  attemptId: Id<"executionAttempts">,
  reason: string,
  now = Date.now(),
): Promise<number> {
  const requests = await outstandingForAttempt(ctx, attemptId, CLOSE_BATCH_SIZE);
  for (const request of requests) {
    await closeRequest(ctx, request, reason, now);
  }
  return requests.length;
}

export async function closeRuntimePermissionsForRun(
  ctx: MutationCtx,
  runId: Id<"executionRuns">,
  reason: string,
  now = Date.now(),
): Promise<number> {
  const grouped = await Promise.all(OUTSTANDING_STATUSES.map((status) =>
    ctx.db.query("runtimePermissionRequests")
      .withIndex("by_run_status", (query) =>
        query.eq("runId", runId).eq("status", status)
      )
      .take(CLOSE_BATCH_SIZE)
  ));
  const requests = grouped.flat().slice(0, CLOSE_BATCH_SIZE);
  for (const request of requests) await closeRequest(ctx, request, reason, now);
  return requests.length;
}

async function assertResponseCommand(
  ctx: MutationCtx,
  context: RuntimeRequestEventContext,
  request: PermissionRequest,
  event: ResolvedEvent,
): Promise<void> {
  if (!request.responseCommandRecordId) return;
  const command = await ctx.db.get(request.responseCommandRecordId);
  const payload = parseResponsePayload(command?.payload);
  if (
    !command
    || context.command._id !== request.responseCommandRecordId
    || command.runId !== context.run._id
    || command.attemptId !== context.attempt._id
    || command.expectedFence !== context.attempt.fence
    || command.type !== "permission_response"
    || command.authorizationSource !== "interactive_confirmation"
    || command.targetDeviceId !== context.attempt.deviceId
    || command.claimedBy !== context.command.claimedBy
    || (command.status !== "acknowledged" && command.status !== "completed")
    || payload?.permissionRequestId !== event.permissionRequestId
    || payload?.decision !== event.decision
  ) {
    throw permissionError(
      "RUNTIME_PERMISSION_COMMAND_MISMATCH",
      "Runtime permission resolution does not match its response command",
    );
  }
}

function parseResponsePayload(payload: string | undefined): {
  permissionRequestId: string;
  decision: string;
} | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    if (
      typeof parsed.permissionRequestId !== "string"
      || typeof parsed.decision !== "string"
    ) return null;
    return {
      permissionRequestId: parsed.permissionRequestId,
      decision: parsed.decision,
    };
  } catch {
    return null;
  }
}

async function requestsForNativeId(
  ctx: MutationCtx,
  attemptId: Id<"executionAttempts">,
  permissionRequestId: string,
): Promise<PermissionRequest[]> {
  return await ctx.db.query("runtimePermissionRequests")
    .withIndex("by_attempt_request", (query) =>
      query.eq("attemptId", attemptId).eq("permissionRequestId", permissionRequestId)
    )
    .order("desc")
    .collect();
}

async function outstandingForAttempt(
  ctx: MutationCtx,
  attemptId: Id<"executionAttempts">,
  limit: number,
): Promise<PermissionRequest[]> {
  const grouped = await Promise.all(OUTSTANDING_STATUSES.map((status) =>
    ctx.db.query("runtimePermissionRequests")
      .withIndex("by_attempt_status", (query) =>
        query.eq("attemptId", attemptId).eq("status", status)
      )
      .take(limit)
  ));
  return grouped.flat().slice(0, limit);
}

async function hasOutstandingPermission(
  ctx: MutationCtx,
  attemptId: Id<"executionAttempts">,
): Promise<boolean> {
  const rows = await outstandingForAttempt(ctx, attemptId, 1);
  return rows.length > 0;
}

async function closeRequest(
  ctx: MutationCtx,
  request: PermissionRequest,
  reason: string,
  now: number,
): Promise<void> {
  await ctx.db.patch(request._id, {
    status: "closed",
    closedAt: now,
    closedReason: reason.slice(0, 500),
    updatedAt: now,
  });
}

function isOutstanding(status: string): boolean {
  return status === "pending" || status === "responding" || status === "expired";
}

function permissionError(code: string, message: string): ConvexError<{
  code: string;
  message: string;
}> {
  return new ConvexError({ code, message });
}
