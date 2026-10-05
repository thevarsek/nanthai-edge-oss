import { recordDecisionHelperUsage } from "./decision_helper_usage";
import { aggregateRuntimeUsage } from "./usage_aggregation";
import { recordRuntimeInputEvent } from "./input_requests";
import type { MutationCtx } from "../_generated/server";
import type { authenticateOnlineRuntimeHost } from "./host_session_auth";
import type { ingestRuntimeEventHandler } from "./chat_event_ingestion";
import { WorkerToHostMessageSchema } from "./protocol_process";
import { assertCurrentExecution } from "../execution/attempts";
import { assertClaimedCredential } from "./chat_event_context";
import { classifySequenceReplay } from "./worker_sequence";
import { transitionRuntimeCommand } from "../execution/commands";
import { bindRuntimeSession, releaseRuntimeSession } from "../execution/bindings";
import { signalRuntimeCompletionHandler } from "./runtime_workflow_events";
import { recordRuntimePermissionRequested, recordRuntimePermissionResolved, closeRuntimePermissionsForAttempt } from "./permission_ingestion";
import { projectConsequentialAdapterEvent } from "./event_projection";
import { appendExecutionEvent } from "../execution/control_plane";
import { assertWorkerCommandCorrelation, assertWorkerEventIdentity } from "./chat_event_context";

export async function ingestHelperEvent(
  ctx: MutationCtx,
  args: Parameters<typeof ingestRuntimeEventHandler>[1],
  host: Awaited<ReturnType<typeof authenticateOnlineRuntimeHost>>,
): Promise<boolean> {
  const event = args.event;
  const [run, attempt, command] = await Promise.all([ctx.db.get(event.runId), ctx.db.get(event.attemptId), ctx.db.get(event.commandRecordId)]);
  if (!run || run.domainType !== "local_helper" || !run.domainId || !attempt || !command
    || attempt.deviceId !== host.device.deviceId || attempt.runId !== run._id || attempt.fence !== event.fence
    || run.userId !== host.device.userId || attempt.userId !== run.userId || command.userId !== run.userId
    || command.runId !== run._id || command.attemptId !== attempt._id || command.expectedFence !== attempt.fence
    || command.targetDeviceId !== host.device.deviceId || command.commandId !== event.commandId) throw new Error("LOCAL_HELPER_EVENT_MISMATCH");
  const task = await ctx.db.query("runtimeHelperTasks").withIndex("by_run", q => q.eq("runId", run._id)).unique();
  if (!task || task.attemptId !== attempt._id || !task.completionEventId) throw new Error("LOCAL_HELPER_EVENT_MISMATCH");
  await assertClaimedCredential(ctx, command.claimedBy, host);
  const message = event.kind === "worker_message" ? WorkerToHostMessageSchema.parse(event.payload) : null;
  const expectedEventId = message ? `${command.commandId}:worker:${message.sequence}` : `${command.commandId}:host-failure`;
  if (event.eventId !== expectedEventId) throw new Error("RUNTIME_EVENT_ID_CONFLICT");
  const job = task.sourceJobId ? await ctx.db.get(task.sourceJobId) : null;
  if (!job && task.purpose !== "decision") throw new Error("LOCAL_HELPER_SOURCE_MISSING");
  const context = { host, run, attempt, command, job: { _id: job?._id, chatId: task.chatId, sourceExecutionId: job?.sourceExecutionId, runtimeCommandRecordId: task.commandRecordId } };
  if (message) { assertWorkerCommandCorrelation(context, message); assertWorkerEventIdentity({ run, attempt }, message); }
  if (message && classifySequenceReplay({ attempt }, message.sequence, event.eventId)) return true;
  // Helper output is private and a terminal helper cannot commit product effects.
  // ACK authenticated late delivery so an aborted helper cannot poison restart.
  if (["completed", "failed", "cancelled"].includes(run.state)) return true;

  const claimantId = attempt.claimantId === command.claimedBy && command.status === "acknowledged"
    ? attempt.claimantId : host.claimantId;
  await assertCurrentExecution(ctx, { attemptId: attempt._id, fence: attempt.fence, claimantId,
    allowExpiredLease: claimantId !== host.claimantId, allowWaiting: true, allowCancelling: true });
  const adapterEvent = message?.kind === "adapter_event" ? message.payload.event : null;

  const nativeSessionId = message?.kind === "session_result" ? message.payload.nativeSessionId : adapterEvent?.type === "session_started" ? adapterEvent.nativeSessionId : undefined;
  if (nativeSessionId) await bindRuntimeSession(ctx, { attemptId: attempt._id, fence: attempt.fence, adapterId: attempt.adapterId, nativeSessionId, bindingKey: `helper:${String(task._id)}`, deviceId: host.device.deviceId });
  if (adapterEvent && run.state !== "cancelling") {
    const projection = projectConsequentialAdapterEvent(adapterEvent);
    if (projection) await appendExecutionEvent(ctx, { attemptId: attempt._id, fence: attempt.fence, claimantId,
      allowExpiredLease: claimantId !== host.claimantId, ...projection, now: adapterEvent.occurredAt });
  }
  if (adapterEvent?.type === "input_requested" || adapterEvent?.type === "input_resolved") await recordRuntimeInputEvent(ctx, context, adapterEvent);
  if (adapterEvent?.type === "permission_requested") await recordRuntimePermissionRequested(ctx, context, adapterEvent);
  if (adapterEvent?.type === "permission_resolved") await recordRuntimePermissionResolved(ctx, context, adapterEvent);
  if (adapterEvent?.type === "usage_reported" && run.state !== "cancelling") {
    await ctx.db.patch(task._id, { runtimeUsage: aggregateRuntimeUsage(task.runtimeUsage, adapterEvent) });
    if (task.purpose === "decision") await recordDecisionHelperUsage(ctx, { ...task, runtimeUsage: aggregateRuntimeUsage(undefined, adapterEvent) }, attempt, adapterEvent.eventId);
  }
  if (adapterEvent?.type === "text_delta" && run.state !== "cancelling") {
    await ctx.db.patch(task._id, { content: task.content + adapterEvent.delta });
  }
  const terminal = message?.kind === "terminal_event" ? message.payload.event : null;
  const rejected = message?.kind === "command_result" && message.payload.status === "rejected"
    || message?.kind === "protocol_error" && !message.payload.recoverable || event.kind === "host_command_failed";
  if (terminal || rejected) {
    const completed = terminal?.outcome === "completed" && run.state !== "cancelling";
    if (command.status === "acknowledged") await transitionRuntimeCommand(ctx, command, { status: completed ? "completed" : "rejected", claimantId, now: Date.now() });
    const bindings = await ctx.db.query("runtimeSessionBindings").withIndex("by_attempt_status", q => q.eq("attemptId", attempt._id).eq("status", "active")).collect();
    for (const binding of bindings) await releaseRuntimeSession(ctx, { bindingId: binding._id, attemptId: attempt._id, fence: attempt.fence, status: "released", now: Date.now() });
    if (task.purpose === "decision") await closeRuntimePermissionsForAttempt(ctx, attempt._id, completed ? "helper_completed" : "helper_failed");
    await ctx.db.patch(task._id, { status: completed ? "ready" : "failed" });
    await ctx.db.patch(attempt._id, { leaseExpiresAt: Date.now() + 120_000 });
    await signalRuntimeCompletionHandler(ctx, { eventId: task.completionEventId, value: { status: completed ? "completed" : "failed", commandId: command.commandId } });
  }
  if (message) await ctx.db.patch(attempt._id, { runtimeLastWorkerSequence: message.sequence, runtimeLastWorkerEventId: event.eventId, updatedAt: Date.now() });
  return true;
}
