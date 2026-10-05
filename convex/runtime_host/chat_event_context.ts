import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { WorkerToHostMessage } from "./protocol_process";
import type { authenticateOnlineRuntimeHost } from "./host_session_auth";
import type { RuntimeChatEventContext } from "./chat_terminal_ingestion";

type AuthenticatedRuntimeHost = Awaited<
  ReturnType<typeof authenticateOnlineRuntimeHost>
>;

export async function loadRuntimeChatEventContext(
  ctx: MutationCtx,
  event: {
    commandRecordId: Id<"runtimeCommands">;
    commandId: string;
    runId: Id<"executionRuns">;
    attemptId: Id<"executionAttempts">;
    fence: number;
  },
  host: AuthenticatedRuntimeHost,
): Promise<RuntimeChatEventContext> {
  const attempt = await ctx.db.get(event.attemptId);
  if (!attempt || attempt.deviceId !== host.device.deviceId) {
    throw eventError(
      "RUNTIME_ROUTE_MISMATCH",
      "Runtime event belongs to another execution route",
    );
  }
  if (attempt.runId !== event.runId || attempt.fence !== event.fence) {
    throw eventError(
      "RUNTIME_EVENT_EXECUTION_MISMATCH",
      "Runtime event does not match its fenced execution attempt",
    );
  }
  const run = await ctx.db.get(attempt.runId);
  if (!run?.generationJobId) {
    throw eventError(
      "RUNTIME_GENERATION_RUN_REQUIRED",
      "Runtime event is not attached to a generation run",
    );
  }
  const [job, command] = await Promise.all([
    ctx.db.get(run.generationJobId),
    ctx.db.query("runtimeCommands")
      .withIndex("by_run_command", (query) =>
        query.eq("runId", run._id).eq("commandId", event.commandId),
      )
      .unique(),
  ]);
  if (
    !job
    || !job.runtimeCommandRecordId
    || !command
    || command._id !== event.commandRecordId
    || command.attemptId !== attempt._id
    || command.expectedFence !== attempt.fence
    || command.targetDeviceId !== host.device.deviceId
    || command.userId !== run.userId
    || attempt.userId !== run.userId
    || job.userId !== run.userId
    || job.executionRunId !== run._id
    || job.executionAttemptId !== attempt._id
    || job.executionFence !== attempt.fence
    || (command.status !== "acknowledged"
      && command.status !== "completed"
      && command.status !== "rejected")
  ) {
    throw eventError(
      "RUNTIME_EVENT_COMMAND_MISMATCH",
      "Runtime event does not match its canonical command",
    );
  }
  await assertClaimedCredential(ctx, command.claimedBy, host);
  return { host, run, attempt, job, command };
}

export function assertWorkerCommandCorrelation(
  context: Pick<RuntimeChatEventContext, "command"> & { job: Pick<RuntimeChatEventContext["job"], "runtimeCommandRecordId"> },
  message: WorkerToHostMessage,
): void {
  if (context.job.runtimeCommandRecordId === context.command._id) return;
  if (
    (message.kind === "command_result" || message.kind === "protocol_error")
    && isSupportedFollowup(context.command.type)
  ) return;
  if (
    context.command.type === "permission_response"
    && message.kind === "adapter_event"
    && message.payload.event.type === "permission_resolved"
  ) return;
  if (context.command.type === "prompt" && message.kind === "adapter_event" && message.payload.event.type === "input_resolved") return;
  throw eventError(
    "RUNTIME_EVENT_COMMAND_MISMATCH",
    "Runtime worker event does not match a supported follow-up command",
  );
}

export function assertWorkerEventIdentity(
  context: Pick<RuntimeChatEventContext, "run" | "attempt">,
  message: WorkerToHostMessage,
): void {
  if (message.kind !== "adapter_event" && message.kind !== "terminal_event") return;
  const event = message.payload.event;
  if (
    event.runId !== String(context.run._id)
    || event.attemptId !== String(context.attempt._id)
    || event.fence !== context.attempt.fence
  ) {
    throw eventError(
      "RUNTIME_ADAPTER_EVENT_IDENTITY_MISMATCH",
      "Runtime adapter event does not match its fenced execution attempt",
    );
  }
}

export async function assertClaimedCredential(
  ctx: MutationCtx,
  claimedBy: string | undefined,
  host: AuthenticatedRuntimeHost,
): Promise<void> {
  if (host.presence.credentialId !== host.credential.credentialId) {
    throw eventError(
      "RUNTIME_EVENT_CREDENTIAL_MISMATCH",
      "Runtime presence was authenticated with another device credential",
    );
  }
  const prefix = `runtime-host:${host.device.deviceId}:`;
  if (!claimedBy?.startsWith(prefix)) {
    throw eventError(
      "RUNTIME_EVENT_COMMAND_MISMATCH",
      "Runtime command was not claimed by its target device",
    );
  }
  if (claimedBy === host.claimantId) return;
  const claimedPresence = await ctx.db.query("runtimeDevicePresences")
    .withIndex("by_device_session", (query) =>
      query.eq("runtimeDeviceId", host.device._id)
        .eq("presenceSessionId", claimedBy.slice(prefix.length)),
    )
    .unique();
  if (claimedPresence?.credentialId !== host.credential.credentialId) {
    throw eventError(
      "RUNTIME_EVENT_CREDENTIAL_MISMATCH",
      "Runtime command was claimed with another device credential",
    );
  }
}

function isSupportedFollowup(type: string): boolean {
  return type === "prompt" || type === "cancel" || type === "interrupt"
    || type === "permission_response" || type === "shutdown";
}

function eventError(code: string, message: string): ConvexError<{
  code: string;
  message: string;
}> {
  return new ConvexError({ code, message });
}
