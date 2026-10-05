import { classifySequenceReplay } from "./worker_sequence";
import { ingestHelperEvent } from "./helper_event_ingestion";
import { ConvexError, v } from "convex/values";
import { mutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { assertCurrentExecution } from "../execution/attempts";
import { authenticateOnlineRuntimeHost } from "./host_session_auth";
import {
  WorkerToHostMessageSchema,
  type WorkerToHostMessage,
} from "./protocol_process";
import {
  applyRuntimeWorkerMessage,
  failRuntimeTurn,
  type RuntimeCredentialInput,
} from "./chat_event_apply";
import type { RuntimeChatEventContext } from "./chat_terminal_ingestion";
import {
  assertWorkerCommandCorrelation,
  assertWorkerEventIdentity,
  loadRuntimeChatEventContext,
} from "./chat_event_context";

const credentialArgs = {
  deviceId: v.string(),
  credentialId: v.string(),
  credential: v.string(),
  presenceSessionId: v.string(),
};

const runtimeEvent = v.object({
  eventId: v.string(),
  commandRecordId: v.id("runtimeCommands"),
  commandId: v.string(),
  runId: v.id("executionRuns"),
  attemptId: v.id("executionAttempts"),
  fence: v.number(),
  kind: v.union(v.literal("worker_message"), v.literal("host_command_failed")),
  emittedAtMs: v.number(),
  payload: v.any(),
});
export const ingestRuntimeEvent = mutation({
  args: { ...credentialArgs, event: runtimeEvent },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> =>
    await ingestRuntimeEventHandler(ctx, args),
});

export const ingestRuntimeEvents = mutation({
  args: { ...credentialArgs, events: v.array(runtimeEvent) },
  returns: v.array(v.string()),
  handler: ingestRuntimeEventsHandler,
});

export async function ingestRuntimeEventsHandler(
  ctx: MutationCtx,
  args: RuntimeCredentialInput & {
    events: Array<Parameters<typeof ingestRuntimeEventHandler>[1]["event"]>;
  },
): Promise<string[]> {
  if (args.events.length < 1 || args.events.length > 100) {
    throw runtimeEventError("RUNTIME_EVENT_BATCH_INVALID", "Runtime event batches require 1–100 events");
  }
  const acceptedEventIds: string[] = [];
  for (const event of args.events) {
    if (await ingestRuntimeEventHandler(ctx, { ...args, event })) {
      acceptedEventIds.push(event.eventId);
    }
  }
  return acceptedEventIds;
}

export async function ingestRuntimeEventHandler(
  ctx: MutationCtx,
  args: RuntimeCredentialInput & {
    event: {
      eventId: string;
      commandRecordId: Id<"runtimeCommands">;
      commandId: string;
      runId: Id<"executionRuns">;
      attemptId: Id<"executionAttempts">;
      fence: number;
      kind: "worker_message" | "host_command_failed";
      emittedAtMs: number;
      payload: unknown;
    };
  },
): Promise<boolean> {
  const credentials: RuntimeCredentialInput = args;
  const host = await authenticateOnlineRuntimeHost(ctx, args);
  const eventRun = await ctx.db.get(args.event.runId);
  if (eventRun?.domainType === "local_helper") return ingestHelperEvent(ctx, args, host);
  const context = await loadRuntimeChatEventContext(ctx, args.event, host);

  if (args.event.kind === "host_command_failed") {
    const expectedEventId = `${context.command.commandId}:host-failure`;
    if (args.event.eventId !== expectedEventId) {
      throw runtimeEventError(
        "RUNTIME_HOST_FAILURE_ID_CONFLICT",
        "Runtime Host failure ID does not match its canonical command",
      );
    }
    const failure = hostFailureMessage(args.event.payload);
    if (isSettledRuntimeTurn(context)) return true;
    const claimantId = recoveryClaimant(context);
    const executionContext = claimantId === undefined ? context : {
      ...context, host: { ...context.host, claimantId }, allowExpiredLease: true,
    };
    await assertCurrentExecution(ctx, {
      attemptId: context.attempt._id,
      fence: context.attempt.fence,
      claimantId: claimantId ?? host.claimantId,
      allowExpiredLease: claimantId !== undefined,
      allowCancelling: true,
      allowWaiting: true,
    });
    await failRuntimeTurn(ctx, executionContext, failure, nextFailureSequence(context));
    return true;
  }

  const message = WorkerToHostMessageSchema.parse(args.event.payload);
  assertWorkerCommandCorrelation(context, message);
  assertWorkerEventIdentity(context, message);
  const expectedEventId = `${context.command.commandId}:worker:${message.sequence}`;
  if (args.event.eventId !== expectedEventId) {
    throw new ConvexError({
      code: "RUNTIME_EVENT_ID_CONFLICT",
      message: "Runtime event ID does not match its canonical worker sequence",
    });
  }
  const lateCancellationTerminal = await isLateCancellationTerminalReplay(
    ctx,
    context,
    message,
  );
  const recoveryClaimantId = recoveryClaimant(context, message);
  const replay = classifySequenceReplay(context, message.sequence, args.event.eventId);
  if (replay) {
    if (isSettledCancellationTerminal(context, message) && !lateCancellationTerminal) {
      throw settledEventError();
    }
    return true;
  }

  if (isSettledRuntimeTurn(context)) {
    if (lateCancellationTerminal) {
      await recordWorkerSequence(ctx, context, message.sequence, args.event.eventId);
      return true;
    }
    if (message.kind !== "command_result" || message.payload.status !== "completed") {
      throw settledEventError();
    }
    await recordWorkerSequence(ctx, context, message.sequence, args.event.eventId);
    return true;
  }

  const terminalMessage = message.kind === "terminal_event";
  const executionContext = recoveryClaimantId === undefined
    ? context
    : {
        ...context,
        host: { ...context.host, claimantId: recoveryClaimantId },
        allowExpiredLease: true,
      };
  await assertCurrentExecution(ctx, {
    attemptId: context.attempt._id,
    fence: context.attempt.fence,
    claimantId: recoveryClaimantId ?? host.claimantId,
    allowExpiredLease: recoveryClaimantId !== undefined,
    allowCancelling: terminalMessage || context.run.state === "cancelling",
    allowWaiting: true,
  });
  if (
    (context.run.state === "cancelling" || context.job.status === "cancelled")
    && !terminalMessage
  ) {
    await recordWorkerSequence(ctx, context, message.sequence, args.event.eventId);
    return true;
  }
  await applyRuntimeWorkerMessage(ctx, credentials, executionContext, message);
  await recordWorkerSequence(ctx, context, message.sequence, args.event.eventId);
  return true;
}

async function recordWorkerSequence(
  ctx: MutationCtx,
  context: RuntimeChatEventContext,
  sequence: number,
  eventId: string,
): Promise<void> {
  await ctx.db.patch(context.attempt._id, {
    runtimeLastWorkerSequence: sequence,
    runtimeLastWorkerEventId: eventId,
    updatedAt: Date.now(),
  });
}

function hostFailureMessage(payload: unknown): string {
  if (
    typeof payload !== "object"
    || payload === null
    || !("message" in payload)
    || typeof payload.message !== "string"
    || !payload.message.trim()
  ) {
    throw runtimeEventError(
      "RUNTIME_HOST_FAILURE_INVALID",
      "Runtime Host failure payload is invalid",
    );
  }
  return payload.message.trim().slice(0, 2_000);
}

function isTerminalJob(status: string): boolean {
  return status === "completed" || status === "failed"
    || status === "cancelled" || status === "timedOut";
}

function isSettledRuntimeTurn(context: RuntimeChatEventContext): boolean {
  // A recorded timeout failure can still need its native cancellation drained.
  return isTerminalJob(context.job.status)
    && context.run.state !== "cancelling";
}

function isSettledCancellationTerminal(
  context: RuntimeChatEventContext,
  message: WorkerToHostMessage,
): boolean {
  return message.kind === "terminal_event"
    && (context.job.status === "cancelled" || context.job.status === "failed")
    && context.run.state === "cancelled"
    && context.run.terminalOutcome === "cancelled"
    && context.attempt.status === "cancelled";
}

function recoveryClaimant(
  context: RuntimeChatEventContext,
  message?: WorkerToHostMessage,
): string | undefined {
  const claimantId = context.attempt.claimantId;
  if (
    context.attempt.status !== "running"
    || claimantId === undefined
    || context.command.claimedBy !== claimantId
  ) return undefined;
  if (context.run.state === "cancelling" || context.job.status === "cancelled") {
    if (
      message?.kind === "terminal_event"
      && (message.payload.event.outcome !== "cancelled"
        && message.payload.event.outcome !== "interrupted")
    ) return undefined;
  } else if (
    claimantId === context.host.claimantId
    || context.command.status !== "acknowledged"
  ) return undefined;
  return claimantId;
}

async function isLateCancellationTerminalReplay(
  ctx: MutationCtx,
  context: RuntimeChatEventContext,
  message: WorkerToHostMessage,
): Promise<boolean> {
  if (
    message.kind !== "terminal_event"
    || (message.payload.event.outcome !== "cancelled"
      && message.payload.event.outcome !== "interrupted")
    || context.job.runtimeCommandRecordId !== context.command._id
    || (context.job.status !== "cancelled" && context.job.status !== "failed")
    || context.run.state !== "cancelled"
    || context.run.terminalOutcome !== "cancelled"
    || context.attempt.status !== "cancelled"
    || (context.command.status !== "completed" && context.command.status !== "rejected")
  ) return false;
  const canonicalMessage = await ctx.db.get(context.job.messageId);
  return canonicalMessage?.status === context.job.status;
}

function nextFailureSequence(context: RuntimeChatEventContext): number {
  return (context.attempt.runtimeLastWorkerSequence ?? -1) + 1;
}

function settledEventError(): ConvexError<{ code: string; message: string }> {
  return runtimeEventError(
    "RUNTIME_EVENT_AFTER_TERMINAL",
    "Runtime event cannot follow the settled terminal state",
  );
}

function runtimeEventError(code: string, message: string): ConvexError<{
  code: string;
  message: string;
}> {
  return new ConvexError({ code, message });
}
