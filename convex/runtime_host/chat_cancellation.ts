import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { enqueueRuntimeHostCommand } from "./command_transport";

export const LOCAL_CANCEL_COMMAND_WINDOW_MS = 30_000;

/** Keep the owned turn claim alive long enough for tree teardown to deliver Stop. */
export async function deferActiveLocalTurnCancellation(
  ctx: MutationCtx,
  run: Doc<"executionRuns">,
  requestedBy: string,
  reason: string,
  now: number,
): Promise<boolean> {
  if (!run.generationJobId || !run.activeAttemptId || run.state !== "cancelling") return false;
  const [job, attempt] = await Promise.all([
    ctx.db.get(run.generationJobId), ctx.db.get(run.activeAttemptId),
  ]);
  if (!job || attempt?.executorKind !== "local_runtime" || !attempt.deviceId || !attempt.claimantId) return false;
  const { deviceId, claimantId } = attempt;
  const prefix = `runtime-host:${deviceId}:`;
  if (!claimantId.startsWith(prefix)) return false;
  const device = await ctx.db.query("runtimeDevices")
    .withIndex("by_device_id", q => q.eq("deviceId", deviceId)).unique();
  if (!device || device.status !== "active") return false;
  const presence = await ctx.db.query("runtimeDevicePresences")
    .withIndex("by_device_session", q => q.eq("runtimeDeviceId", device._id)
      .eq("presenceSessionId", claimantId.slice(prefix.length))).unique();
  if (presence?.status !== "online" || presence.expiresAt <= now) return false;
  const commandId = `cancel-${String(job._id)}-${attempt.fence}`;
  const read = () => ctx.db.query("runtimeCommands")
    .withIndex("by_run_command", q => q.eq("runId", run._id).eq("commandId", commandId)).unique();
  let command = await read();
  if (!command) {
    if (!await enqueueActiveLocalTurnCancellation(ctx, { job, run, requestedBy, reason, now })) return false;
    command = await read();
  }
  return command != null && (command.status === "pending" || command.status === "acknowledged")
    && command.expiresAt !== undefined && command.expiresAt > now;
}

export async function enqueueActiveLocalTurnCancellation(
  ctx: MutationCtx,
  args: {
    job: Doc<"generationJobs">;
    run: Doc<"executionRuns">;
    requestedBy: string;
    reason: string;
    now: number;
  },
): Promise<boolean> {
  if (!args.run.activeAttemptId || !args.job.runtimeCommandRecordId) return false;
  const [attempt, turnCommand] = await Promise.all([
    ctx.db.get(args.run.activeAttemptId),
    ctx.db.get(args.job.runtimeCommandRecordId),
  ]);
  if (
    !attempt
    || attempt.executorKind !== "local_runtime"
    || attempt.placement !== "local"
    || !attempt.deviceId
    || !turnCommand
    || turnCommand.runId !== args.run._id
    || turnCommand.attemptId !== attempt._id
    || turnCommand.expectedFence !== attempt.fence
    || turnCommand.targetDeviceId !== attempt.deviceId
    || turnCommand.status !== "acknowledged"
    || !attempt.claimantId
    || turnCommand.claimedBy !== attempt.claimantId
  ) return false;
  const deviceId = attempt.deviceId;
  const device = await ctx.db.query("runtimeDevices")
    .withIndex("by_device_id", (query) => query.eq("deviceId", deviceId))
    .unique();
  if (!device || device.userId !== args.run.userId || device.status !== "active") return false;

  const cancellationId = `cancel-${String(args.job._id)}-${attempt.fence}`;
  const payload = JSON.stringify({
    cancellationId,
    reason: args.reason.slice(0, 2_000),
  });
  await enqueueRuntimeHostCommand(ctx, {
    runId: args.run._id,
    attemptId: attempt._id,
    fence: attempt.fence,
    targetDeviceId: deviceId,
    commandId: cancellationId,
    type: "cancel",
    authorizationSource: args.requestedBy === args.run.userId
      ? "explicit_user_turn"
      : "runtime_policy",
    initiatedBy: args.run.userId,
    payload,
    expiresAt: args.now + LOCAL_CANCEL_COMMAND_WINDOW_MS,
    now: args.now,
  });
  return true;
}
