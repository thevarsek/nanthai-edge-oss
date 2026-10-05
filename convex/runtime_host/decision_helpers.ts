import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { assertCurrentExecution } from "../execution/attempts";
import { createExecutionRun } from "../execution/runs";
import { linkExecutionComponent } from "../execution/component_refs";
import { resolveEffectiveParticipantRoute } from "./route_resolution";
import { getCollaborationDecisionDeadline, assertCollaborationDecisionDeadline } from "./decision_deadline";

export const hasCloudConnection = internalQuery({
  args: { runId: v.id("executionRuns") }, returns: v.boolean(),
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return false;
    const userId = run.userId;
    const secret = await ctx.db.query("userSecrets").withIndex("by_user", q => q.eq("userId", userId)).first();
    return Boolean(secret?.apiKey);
  },
});

export const start = internalMutation({
  args: {
    parentAttemptId: v.id("executionAttempts"), parentFence: v.number(),
    chatId: v.id("chats"), sourceMessageId: v.id("messages"), requestKey: v.string(),
    participantIds: v.array(v.id("chatParticipants")),
    messages: v.array(v.object({ role: v.string(), content: v.string() })),
  }, returns: v.union(v.id("runtimeHelperTasks"), v.null()),
  handler: async (ctx, args) => {
    const { run } = await assertCurrentExecution(ctx, { attemptId: args.parentAttemptId, fence: args.parentFence });
    assertCollaborationDecisionDeadline(await getCollaborationDecisionDeadline(ctx, run));
    const source = await ctx.db.get(args.sourceMessageId);
    if (run.chatId !== args.chatId || source?.chatId !== args.chatId || source.userId !== run.userId) throw new Error("DECISION_PARENT_MISMATCH");
    const requestKey = `${String(run._id)}:${args.parentFence}:${args.requestKey}`;
    const existing = await ctx.db.query("runtimeHelperTasks").withIndex("by_request", q => q.eq("userId", run.userId).eq("requestKey", requestKey)).unique();
    if (existing) return existing._id;
    for (const participantId of args.participantIds) {
      const participant = await ctx.db.get(participantId);
      if (participant?.chatId !== args.chatId || participant.userId !== run.userId) continue;
      const route = await resolveEffectiveParticipantRoute(ctx, { userId: run.userId, chatParticipantId: participantId });
      if (route?.placement !== "local" || route.availability !== "ready" || !route.personaId || !route.deviceId || !route.adapterId) continue;
      const device = await ctx.db.query("runtimeDevices").withIndex("by_device_id", q => q.eq("deviceId", route.deviceId!)).unique();
      const presence = device?.currentPresenceId ? await ctx.db.get(device.currentPresenceId) : null;
      const adapter = presence?.adapters.find(item => item.adapterId === route.adapterId);
      if (!adapter) continue;
      const taskId = await ctx.db.insert("runtimeHelperTasks", {
        userId: run.userId, chatId: args.chatId, sourceMessageId: args.sourceMessageId,
        personaId: route.personaId, requestKey, purpose: "decision", input: args.requestKey,
        messages: args.messages, content: "", status: "waiting", createdAt: Date.now(),
      });
      const execution = await createExecutionRun(ctx, {
        userId: run.userId, chatId: args.chatId, sourceMessageId: args.sourceMessageId,
        kind: "maintenance", requestedPlacement: "local", runKey: `helper:${String(taskId)}`,
        domainType: "local_helper", domainId: String(taskId), parentRunId: run._id,
        initialAttempt: {
          executorKind: "local_runtime", placement: "local", adapterId: adapter.adapterId,
          adapterVersion: adapter.adapterVersion, deviceId: route.deviceId, runtimeLabel: route.deviceName,
          chatParticipantId: participantId,
          ...(adapter.adapterId === "codex" ? { modelId: "gpt-6-luna", provider: "openai", modelSelectionMode: "explicit" as const }
            : { modelId: route.modelId, provider: route.provider, modelSelectionMode: route.modelSelectionMode ?? "adapter_default" as const }),
        },
      });
      await ctx.db.patch(taskId, { runId: execution.runId, attemptId: execution.attemptId, fence: execution.fence });
      return taskId;
    }
    return null;
  },
});

export const bindWorkflow = internalMutation({
  args: { taskId: v.id("runtimeHelperTasks"), workflowId: v.string() }, returns: v.null(),
  handler: async (ctx, { taskId, workflowId }) => {
    const task = await ctx.db.get(taskId);
    if (!task || task.purpose !== "decision" || !task.runId || !task.attemptId || task.fence === undefined) return null;
    await assertCurrentExecution(ctx, { attemptId: task.attemptId, fence: task.fence });
    await linkExecutionComponent(ctx, { runId: task.runId, attemptId: task.attemptId, fence: task.fence, adapterId: "convex-workflow", operationId: workflowId, role: "local-helper" });
    return null;
  },
});
