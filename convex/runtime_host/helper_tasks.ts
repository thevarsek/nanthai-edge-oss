import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { createExecutionRun } from "../execution/runs";
import { linkExecutionComponent } from "../execution/component_refs";
import { durableWorkflow } from "../execution/components";
import { terminalizeExecution } from "../execution/control_plane";
import { terminalizeExecutionComponentsForRun } from "../execution/component_refs";
import { transitionRuntimeCommand } from "../execution/commands";
import { isUserDataWritable } from "../lib/write_fence";
import { getCollaborationDecisionDeadline } from "./decision_deadline";
import { signalRuntimeCompletionHandler } from "./runtime_workflow_events";

export const start = internalMutation({
  args: {
    userId: v.string(), chatId: v.id("chats"), messageId: v.id("messages"),
    purpose: v.union(v.literal("memory"), v.literal("title"), v.literal("forget")),
    messages: v.array(v.object({ role: v.string(), content: v.string() })),
    input: v.string(),
  },
  returns: v.union(v.id("runtimeHelperTasks"), v.null()),
  handler: async (ctx, args) => {
    if (!await isUserDataWritable(ctx, args.userId, args.chatId)) return null;
    const job = await ctx.db.query("generationJobs").withIndex("by_message", q => q.eq("messageId", args.messageId)).first();
    const sourceAttempt = job?.executionAttemptId ? await ctx.db.get(job.executionAttemptId) : null;
    if (!job || job.userId !== args.userId || job.chatId !== args.chatId || sourceAttempt?.placement !== "local"
      || !["codex", "pi"].includes(sourceAttempt.adapterId) || !sourceAttempt.deviceId || !sourceAttempt.chatParticipantId) return null;
    const existing = await ctx.db.query("runtimeHelperTasks").withIndex("by_source_purpose", q => q.eq("sourceMessageId", args.messageId).eq("purpose", args.purpose)).unique();
    if (existing) return existing._id;
    const device = await ctx.db.query("runtimeDevices").withIndex("by_device_id", q => q.eq("deviceId", sourceAttempt.deviceId!)).unique();
    const presence = device?.currentPresenceId ? await ctx.db.get(device.currentPresenceId) : null;
    if (device?.status !== "active" || !presence || presence.status !== "online" || presence.expiresAt <= Date.now()) return null;
    const adapter = presence.adapters.find(item => item.adapterId === sourceAttempt.adapterId && item.authState === "ready");
    if (!adapter) return null;
    const taskId = await ctx.db.insert("runtimeHelperTasks", {
      userId: args.userId, chatId: args.chatId, sourceMessageId: args.messageId,
      sourceJobId: job._id, purpose: args.purpose, input: args.input, messages: args.messages,
      content: "", status: "waiting", createdAt: Date.now(),
    });
    const execution = await createExecutionRun(ctx, {
      userId: args.userId, chatId: args.chatId, sourceMessageId: args.messageId,
      kind: "maintenance", requestedPlacement: "local", runKey: `helper:${String(taskId)}`,
      domainType: "local_helper", domainId: String(taskId),
      initialAttempt: {
        executorKind: "local_runtime", placement: "local", adapterId: adapter.adapterId, adapterVersion: adapter.adapterVersion,
        deviceId: sourceAttempt.deviceId, runtimeLabel: sourceAttempt.runtimeLabel,
        chatParticipantId: sourceAttempt.chatParticipantId,
        ...(adapter.adapterId === "codex" ? { modelId: "gpt-6-luna", provider: "openai", modelSelectionMode: "explicit" as const }
          : { modelId: sourceAttempt.modelId, provider: sourceAttempt.provider, modelSelectionMode: sourceAttempt.modelSelectionMode ?? "adapter_default" as const }),
      },
    });
    await ctx.db.patch(taskId, { runId: execution.runId, attemptId: execution.attemptId, fence: execution.fence });
    const workflowId = await durableWorkflow.start(ctx, internal.runtime_host.helper_workflow.run, { taskId });
    await linkExecutionComponent(ctx, { ...execution, adapterId: "convex-workflow", operationId: workflowId, role: "local-helper" });
    return taskId;
  },
});

export const get = internalQuery({
  args: { taskId: v.id("runtimeHelperTasks") },
  handler: async (ctx, { taskId }) => {
    const task = await ctx.db.get(taskId);
    if (!task?.attemptId || !task.runId) return null;
    const [attempt, job, run] = await Promise.all([ctx.db.get(task.attemptId), task.sourceJobId ? ctx.db.get(task.sourceJobId) : null, ctx.db.get(task.runId)]);
    const participant = attempt?.chatParticipantId ? await ctx.db.get(attempt.chatParticipantId) : null;
    const personaId = task.personaId ?? job?.effectivePersonaConfig?.personaId ?? participant?.personaId;
    return task && attempt && run && personaId ? { task, attempt, job, run, personaId } : null;
  },
});

export const setEvent = internalMutation({
  args: { taskId: v.id("runtimeHelperTasks"), eventId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => { await ctx.db.patch(args.taskId, { completionEventId: args.eventId }); return null; },
});

export const finish = internalMutation({
  args: { taskId: v.id("runtimeHelperTasks"), failed: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task?.attemptId || task.fence === undefined || !task.runId) return null;
    const attempt = await ctx.db.get(task.attemptId);
    const run = await ctx.db.get(task.runId);
    if (!attempt || !run) return null;
    if ((args.failed || task.status === "failed" || ["failed", "cancelled", "cancelling"].includes(run.state)) && task.commandRecordId) {
      const command = await ctx.db.get(task.commandRecordId);
      if (command?.runId === run._id && command.attemptId === attempt._id
        && ["pending", "acknowledged"].includes(command.status)) {
        await transitionRuntimeCommand(ctx, command, { status: "rejected", claimantId: command.claimedBy,
          rejectionReason: "Local helper stopped before completion" });
      }
    }
    if (["completed", "failed", "cancelled"].includes(run.state)) return null;
    if (run.state === "cancelling") {
      await ctx.db.patch(task._id, { status: "cancelled", completedAt: Date.now() });
      return null; // Central teardown owns remote cancellation acknowledgement.
    }
    const outcome = args.failed || task.status === "failed" ? "failed" : "completed";
    await terminalizeExecutionComponentsForRun(ctx, { runId: run._id, status: outcome });
    await terminalizeExecution(ctx, { attemptId: attempt._id, fence: attempt.fence, outcome, allowWaiting: true, allowExpiredLease: true, summary: `Local ${task.purpose} helper ${outcome}` });
    await ctx.db.patch(task._id, { status: outcome, completedAt: Date.now() });
    return null;
  },
});

export const assertReady = internalQuery({
  args: { taskId: v.id("runtimeHelperTasks") },
  returns: v.boolean(),
  handler: async (ctx, { taskId }) => {
    const task = await ctx.db.get(taskId);
    if (!task?.runId || task.status !== "ready") return false;
    const run = await ctx.db.get(task.runId);
    const [chat, tombstone] = await Promise.all([ctx.db.get(task.chatId), ctx.db.query("accountDeletionTombstones").withIndex("by_user", q => q.eq("userId", task.userId)).unique()]);
    return run?.state === "running" && chat?.userId === task.userId && !chat.isDeleting && !tombstone;
  },
});

export const expire = internalMutation({
  args: { taskId: v.id("runtimeHelperTasks") },
  returns: v.null(),
  handler: async (ctx, { taskId }) => {
    const task = await ctx.db.get(taskId);
    if (!task?.runId || ["completed", "failed", "cancelled"].includes(task.status)) return null;
    await ctx.runMutation(internal.execution.teardown.requestRunTeardown, {
      runId: task.runId, requestedBy: task.userId, reason: "Local helper transport deadline expired",
    });
    await ctx.db.patch(taskId, { status: "failed", completedAt: Date.now() });
    const run = task.purpose === "decision" ? await ctx.db.get(task.runId) : null;
    if (task.completionEventId && (task.purpose === "compaction" || (run?.parentRunId
      && await getCollaborationDecisionDeadline(ctx, await ctx.db.get(run.parentRunId)) !== undefined))) {
      await signalRuntimeCompletionHandler(ctx, {
        eventId: task.completionEventId,
        value: { status: "failed", commandId: `helper-${String(task._id)}-${task.fence}` },
      });
    }
    await ctx.scheduler.runAfter(0, internal.execution.teardown.cancelRunTree, {
      runId: task.runId, requestedBy: task.userId, reason: "Local helper transport deadline expired",
    });
    return null;
  },
});
