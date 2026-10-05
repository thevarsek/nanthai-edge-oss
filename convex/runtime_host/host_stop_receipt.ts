import type { MutationCtx } from "../_generated/server";
import { finishComponentCancellationHandler } from "../execution/teardown";
import { signalRuntimeCompletionHandler } from "./runtime_workflow_events";
import { runtimeHostError, sha256Hex } from "./security";

// Revoked authority can acknowledge stopped processes, never renew or publish.
export async function acknowledgeStoppedRuntimeHost(ctx: MutationCtx, args: {
    deviceId: string; credentialId: string; credential: string;
    presenceSessionId: string; reason: string;
}): Promise<boolean> {
    const credential = await ctx.db.query("runtimeDeviceCredentials")
        .withIndex("by_credential_id", q => q.eq("credentialId", args.credentialId)).unique();
    if (!credential || credential.deviceId !== args.deviceId
        || credential.credentialHash !== await sha256Hex(args.credential)) {
        throw runtimeHostError("UNAUTHORIZED", "Runtime Host stop receipt is not authenticated");
    }
    const device = await ctx.db.get(credential.runtimeDeviceId);
    const presence = await ctx.db.query("runtimeDevicePresences")
        .withIndex("by_device_session", q => q.eq("runtimeDeviceId", credential.runtimeDeviceId)
            .eq("presenceSessionId", args.presenceSessionId)).unique();
    if (!device || device.deviceId !== args.deviceId || device.userId !== credential.userId
        || !presence || presence.credentialId !== credential.credentialId) {
        throw runtimeHostError("UNAUTHORIZED", "Runtime Host stop receipt does not own this presence");
    }
    const claimantId = `runtime-host:${device.deviceId}:${presence.presenceSessionId}`;
    await ctx.db.patch(presence._id, { executionStoppedAt: presence.executionStoppedAt ?? Date.now() });
    const attempts = (await Promise.all((["queued", "claimed", "running", "waiting", "interrupted"] as const)
        .map(status => ctx.db.query("executionAttempts").withIndex("by_device_status", q =>
            q.eq("deviceId", device.deviceId).eq("status", status)).collect()))).flat();
    for (const attempt of attempts) {
        if (attempt.userId !== device.userId) continue;
        const run = await ctx.db.get(attempt.runId);
        if (!run || run.activeAttemptId !== attempt._id) continue;
        if (attempt.claimantId !== claimantId) {
            if (attempt.status !== "queued" || run.domainType !== "local_helper"
                || device.currentPresenceId && device.currentPresenceId !== presence._id) continue;
            const task = await ctx.db.query("runtimeHelperTasks").withIndex("by_run", q => q.eq("runId", run._id)).unique();
            const sourceJob = task?.sourceJobId ? await ctx.db.get(task.sourceJobId) : null;
            const sourceAttempt = sourceJob?.executionAttemptId ? await ctx.db.get(sourceJob.executionAttemptId) : null;
            if (task?.purpose !== "decision" && sourceAttempt?.claimantId !== claimantId) continue;
        }
        if (run.state !== "cancelling" && run.domainType === "local_helper") {
            const task = await ctx.db.query("runtimeHelperTasks").withIndex("by_run", q => q.eq("runId", run._id)).unique();
            const command = task?.commandRecordId ? await ctx.db.get(task.commandRecordId) : null;
            if (task?.status === "waiting") {
                await ctx.db.patch(task._id, { status: "failed" });
                if (task.completionEventId) await signalRuntimeCompletionHandler(ctx, { eventId: task.completionEventId,
                    value: { status: "failed", commandId: command?.commandId ?? `helper-${String(task._id)}-${attempt.fence}` } });
            }
            continue;
        }
        if (run.state !== "cancelling") continue;
        const refs = await ctx.db.query("executionComponentRefs")
            .withIndex("by_attempt", q => q.eq("attemptId", attempt._id)).collect();
        for (const ref of refs) {
            if (ref.adapterId !== "local-runtime" || ref.runId !== run._id
                || !["active", "cancel_requested"].includes(ref.status)) continue;
            if (ref.status === "active") await ctx.db.patch(ref._id, { status: "cancel_requested", updatedAt: Date.now() });
            await finishComponentCancellationHandler(ctx, { componentRefId: ref._id, cancelled: true });
        }
    }
    if (presence.status === "online") await ctx.db.patch(presence._id, {
        status: "offline", disconnectedAt: Date.now(), disconnectReason: args.reason.slice(0, 500),
    });
    if (device.currentPresenceId === presence._id) await ctx.db.patch(device._id, {
        currentPresenceId: undefined, updatedAt: Date.now(),
    });
    return true;
}
