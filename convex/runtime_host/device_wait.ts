import type { EventId } from "@convex-dev/workflow";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { durableWorkflow } from "../execution/components";
import { appendRunEventUnchecked } from "../execution/events";
import { isIgnorableResumeSignalError } from "../chat/workflow_resume_handlers";

type ReadyAdapter = { adapterId: string; authState: string };
type Signal = (ctx: MutationCtx, eventId: string) => Promise<void>;

async function signalReady(ctx: MutationCtx, eventId: string): Promise<void> {
  try {
    await durableWorkflow.sendEvent(ctx, {
      id: eventId as EventId<string>, validator: v.null(), value: null,
    });
  } catch (error) {
    if (!isIgnorableResumeSignalError(error)) throw error;
  }
}

/** Workflow waits before preparing expiring packets or starting native inference. */
export async function waitForRuntimeDeviceHandler(
  ctx: MutationCtx,
  args: { jobId: Id<"generationJobs">; eventId: string; now?: number },
): Promise<boolean> {
  const job = await ctx.db.get(args.jobId);
  if (!job || !job.executionAttemptId || !job.executionRunId
    || !["queued", "streaming"].includes(job.status)) return false;
  const [attempt, run] = await Promise.all([
    ctx.db.get(job.executionAttemptId), ctx.db.get(job.executionRunId),
  ]);
  if (!attempt?.deviceId || attempt.placement !== "local" || !run
    || run.activeAttemptId !== attempt._id || attempt.fence !== job.executionFence
    || ["completed", "failed", "cancelled", "cancelling"].includes(run.state)) return false;
  const deviceId = attempt.deviceId;
  const device = await ctx.db.query("runtimeDevices")
    .withIndex("by_device_id", q => q.eq("deviceId", deviceId)).unique();
  if (!device || device.userId !== job.userId || device.status !== "active") {
    throw new Error("RUNTIME_DEVICE_UNAVAILABLE");
  }
  const now = args.now ?? Date.now();
  const presence = device.currentPresenceId ? await ctx.db.get(device.currentPresenceId) : null;
  if (presence?.status === "online" && presence.expiresAt > now
    && adapterReady(presence.adapters, attempt.adapterId)) return false;
  // Configured schedules retain their existing no-catch-up contract.
  if (job.sourceJobId) throw new Error("SCHEDULED_RUNTIME_UNAVAILABLE");
  await ctx.db.patch(job._id, {
    runtimeWaitingDeviceId: attempt.deviceId, runtimeDeviceReadyEventId: args.eventId,
  });
  await ctx.db.patch(run._id, { state: "waiting", updatedAt: now });
  await appendRunEventUnchecked(ctx, run, {
    attemptId: attempt._id, fence: attempt.fence, type: "waiting",
    phase: "waiting_for_device", summary: `Waiting for ${device.displayName} to open`,
    eventId: `device-wait:${String(job._id)}:${attempt.fence}`, now,
  });
  return true;
}

export async function wakeRuntimeDeviceWaits(
  ctx: MutationCtx,
  device: Doc<"runtimeDevices">,
  adapters: readonly ReadyAdapter[],
  now = Date.now(),
  signal: Signal = signalReady,
): Promise<number> {
  const jobs = await ctx.db.query("generationJobs")
    .withIndex("by_runtime_waiting_device", q => q.eq("runtimeWaitingDeviceId", device.deviceId))
    .take(100);
  let count = 0;
  for (const job of jobs) {
    if (job.userId !== device.userId || !job.runtimeDeviceReadyEventId
      || !job.executionAttemptId || !job.executionRunId) continue;
    const [attempt, run] = await Promise.all([
      ctx.db.get(job.executionAttemptId), ctx.db.get(job.executionRunId),
    ]);
    if (!attempt || !run || run.activeAttemptId !== attempt._id
      || attempt.fence !== job.executionFence
      || ["completed", "failed", "cancelled", "cancelling"].includes(run.state)
      || !["queued", "streaming"].includes(job.status)) {
      await ctx.db.patch(job._id, { runtimeWaitingDeviceId: undefined, runtimeDeviceReadyEventId: undefined });
      continue;
    }
    if (!adapterReady(adapters, attempt.adapterId)) continue;
    await signal(ctx, job.runtimeDeviceReadyEventId);
    await ctx.db.patch(job._id, { runtimeWaitingDeviceId: undefined, runtimeDeviceReadyEventId: undefined });
    await ctx.db.patch(run._id, { state: "queued", updatedAt: now });
    await appendRunEventUnchecked(ctx, run, {
      attemptId: attempt._id, fence: attempt.fence, type: "model_activity",
      phase: "queued", summary: `${device.displayName} is ready`,
      eventId: `device-ready:${String(job._id)}:${attempt.fence}`, now,
    });
    count += 1;
  }
  return count;
}

function adapterReady(adapters: readonly ReadyAdapter[], adapterId: string): boolean {
  return adapters.some(adapter => adapter.adapterId === adapterId && adapter.authState === "ready");
}

export const waitForDevice = internalMutation({
  args: { jobId: v.id("generationJobs"), eventId: v.string() },
  returns: v.boolean(), handler: waitForRuntimeDeviceHandler,
});
