import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { RuntimePermissionUnavailableReason } from "./permission_validators";

type ReadCtx = Pick<MutationCtx, "db"> | Pick<QueryCtx, "db">;

export type LivePermissionContext = {
  run: Doc<"executionRuns">;
  attempt: Doc<"executionAttempts">;
  job: Doc<"generationJobs"> | null;
  primaryCommand: Doc<"runtimeCommands">;
  device: Doc<"runtimeDevices">;
  presence: Doc<"runtimeDevicePresences">;
};

export type PermissionRuntimeAvailability =
  | { ready: true; context: LivePermissionContext }
  | { ready: false; reason: RuntimePermissionUnavailableReason };

export async function inspectPermissionRuntime(
  ctx: ReadCtx,
  request: Doc<"runtimePermissionRequests">,
  now = Date.now(),
): Promise<PermissionRuntimeAvailability> {
  if (request.expiresAt !== undefined && request.expiresAt <= now) {
    return unavailable("request_expired");
  }
  const [run, attempt, job, primaryCommand] = await Promise.all([
    ctx.db.get(request.runId),
    ctx.db.get(request.attemptId),
    request.generationJobId ? ctx.db.get(request.generationJobId) : null,
    ctx.db.get(request.primaryCommandRecordId),
  ]);
  const helper = run?.domainType === "local_helper"
    ? await ctx.db.query("runtimeHelperTasks").withIndex("by_run", q => q.eq("runId", run._id)).unique()
    : null;
  const sourceMatches = helper
    ? helper.userId === request.userId && helper.sourceJobId === job?._id && helper.attemptId === attempt?._id
      && helper.fence === attempt?.fence && helper.commandRecordId === primaryCommand?._id && helper.status === "waiting"
    : run?.generationJobId === job?._id && job?.executionRunId === run?._id && job?.executionAttemptId === attempt?._id
      && job?.executionFence === attempt?.fence && job?.runtimeCommandRecordId === primaryCommand?._id
      && (job?.status === "queued" || job?.status === "streaming");
  if (
    !sourceMatches
    || !run
    || !attempt
    || (!helper && !job)
    || !primaryCommand
    || run.userId !== request.userId
    || run.chatId !== request.chatId
    || run.activeAttemptId !== attempt._id
    || run.state !== (request.inputSchema ? "waiting_for_input" : "waiting_for_permission")
    || attempt.runId !== run._id
    || attempt.userId !== run.userId
    || attempt.fence !== request.fence
    || attempt.status !== "running"
    || attempt.executorKind !== "local_runtime"
    || attempt.placement !== "local"
    || !attempt.claimantId
    || !attempt.deviceId
    || (attempt.leaseExpiresAt ?? 0) <= now
    || (job && (job.userId !== run.userId || job.chatId !== request.chatId))
    || primaryCommand.runId !== run._id
    || primaryCommand.attemptId !== attempt._id
    || primaryCommand.expectedFence !== attempt.fence
    || primaryCommand.status !== "acknowledged"
    || primaryCommand.claimedBy !== attempt.claimantId
    || primaryCommand.targetDeviceId !== attempt.deviceId
  ) return unavailable("execution_unavailable");

  const device = await ctx.db.query("runtimeDevices")
    .withIndex("by_device_id", (query) => query.eq("deviceId", attempt.deviceId as string))
    .unique();
  if (!device || device.userId !== run.userId || device.status !== "active") {
    return unavailable("runtime_host_offline");
  }
  const claimantPrefix = `runtime-host:${device.deviceId}:`;
  if (!attempt.claimantId.startsWith(claimantPrefix)) {
    return unavailable("runtime_session_unavailable");
  }
  const presenceSessionId = attempt.claimantId.slice(claimantPrefix.length);
  const presence = await ctx.db.query("runtimeDevicePresences")
    .withIndex("by_device_session", (query) =>
      query.eq("runtimeDeviceId", device._id).eq("presenceSessionId", presenceSessionId)
    )
    .unique();
  if (presence && device.currentPresenceId !== presence._id) {
    return unavailable("runtime_session_unavailable");
  }
  if (
    !presence
    || presence.status !== "online"
    || presence.expiresAt <= now
    || presence.credentialId !== device.currentCredentialId
  ) return unavailable("runtime_host_offline");
  const credential = await ctx.db.query("runtimeDeviceCredentials")
    .withIndex("by_credential_id", (query) =>
      query.eq("credentialId", presence.credentialId)
    )
    .unique();
  if (
    !credential
    || credential.runtimeDeviceId !== device._id
    || credential.userId !== run.userId
    || credential.status !== "active"
  ) return unavailable("runtime_host_offline");

  const adapter = presence.adapters.find((candidate) =>
    candidate.adapterId === attempt.adapterId
  );
  if (
    !adapter
    || adapter.authState !== "ready"
    || !(request.inputSchema ? adapter.capabilities.operations.inputResponse : adapter.capabilities.operations.permissionResponse)
    || (attempt.adapterVersion !== undefined
      && adapter.adapterVersion !== attempt.adapterVersion)
  ) return unavailable("runtime_adapter_unavailable");
  const binding = await ctx.db.query("runtimeSessionBindings")
    .withIndex("by_attempt_status", (query) =>
      query.eq("attemptId", attempt._id).eq("status", "active")
    )
    .first();
  if (
    !binding
    || binding.runId !== run._id
    || binding.fence !== attempt.fence
    || binding.adapterId !== attempt.adapterId
    || binding.deviceId !== device.deviceId
  ) return unavailable("runtime_session_unavailable");

  return {
    ready: true,
    context: { run, attempt, job, primaryCommand, device, presence },
  };
}

function unavailable(
  reason: RuntimePermissionUnavailableReason,
): PermissionRuntimeAvailability {
  return { ready: false, reason };
}
