import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { durableWorkflow } from "../execution/components";
import { assertCurrentExecution } from "../execution/attempts";
import { createExecutionRun } from "../execution/runs";
import { linkExecutionComponent } from "../execution/component_refs";
import { runHelperWorkflowHandler } from "../runtime_host/helper_workflow";
import { resolveEffectiveParticipantRoute } from "../runtime_host/route_resolution";
import { assertContextJob } from "./conversation_context_mutations";
import { conversationSummaryMessages } from "./conversation_context_prompt";

// Native conversations retain their existing local connection: canonical
// compaction uses an owned local helper, without requiring an OpenRouter key.
export const start = internalMutation({
  args: {operationId: v.id("conversationCompactions")},
  handler: async (ctx, {operationId}) => {
    const op = await ctx.db.get(operationId);
    if (!op) throw new Error("COMPACTION_MISSING");
    const job = await assertContextJob(ctx, op.jobId);
    const attempt = job.executionAttemptId ? await ctx.db.get(job.executionAttemptId) : null;
    if (!attempt?.chatParticipantId || attempt.placement !== "local") throw new Error("LOCAL_COMPACTION_UNAVAILABLE");
    const requestKey = `conversation-summary:${String(op._id)}:${op.nextChunk}`;
    const existing = await ctx.db.query("runtimeHelperTasks").withIndex("by_request", q => q.eq("userId", op.userId).eq("requestKey", requestKey)).unique();
    if (existing) return existing._id;
    const chunk = await ctx.db.query("conversationCompactionChunks").withIndex("by_operation", q => q.eq("operationId", op._id).eq("ordinal", op.nextChunk)).unique();
    if (!chunk || chunk.status !== "pending") throw new Error("COMPACTION_OUTCOME_UNKNOWN");
    const route = await resolveEffectiveParticipantRoute(ctx, {userId: op.userId, chatParticipantId: attempt.chatParticipantId});
    if (route?.placement !== "local" || route.availability !== "ready" || !route.deviceId || !route.adapterId || !route.personaId) throw new Error("LOCAL_COMPACTION_UNAVAILABLE");
    const taskId = await ctx.db.insert("runtimeHelperTasks", {userId: op.userId, chatId: op.chatId,
      sourceMessageId: job.messageId, sourceJobId: job._id, personaId: route.personaId, purpose: "compaction",
      requestKey, input: JSON.stringify({operationId, ordinal: chunk.ordinal}), messages: conversationSummaryMessages(op.text, chunk.content),
      content: "", status: "waiting", createdAt: Date.now()});
    const execution = await createExecutionRun(ctx, {userId: op.userId, chatId: op.chatId, sourceMessageId: job.messageId,
      kind: "maintenance", requestedPlacement: "local", runKey: `helper:${String(taskId)}`, domainType: "local_helper", domainId: String(taskId), parentRunId: op.runId,
      initialAttempt: {executorKind: "local_runtime", placement: "local", adapterId: route.adapterId, adapterVersion: attempt.adapterVersion,
        deviceId: route.deviceId, runtimeLabel: route.deviceName, chatParticipantId: attempt.chatParticipantId,
        modelId: route.modelId, provider: route.provider, modelSelectionMode: route.modelSelectionMode ?? "adapter_default"}});
    await ctx.db.patch(taskId, {runId: execution.runId, attemptId: execution.attemptId, fence: execution.fence});
    await ctx.db.patch(chunk._id, {status: "calling"});
    return taskId;
  },
});
export const bind = internalMutation({
  args: {taskId: v.id("runtimeHelperTasks"), workflowId: v.string()},
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task?.runId || !task.attemptId || task.fence === undefined || task.purpose !== "compaction") throw new Error("LOCAL_COMPACTION_MISSING");
    await assertCurrentExecution(ctx, {attemptId: task.attemptId, fence: task.fence});
    await linkExecutionComponent(ctx, {runId: task.runId, attemptId: task.attemptId, fence: task.fence, adapterId: "convex-workflow", operationId: args.workflowId, role: "local-helper"});
    return null;
  },
});
export const result = internalMutation({
  args: {taskId: v.id("runtimeHelperTasks")},
  handler: async (ctx, {taskId}) => {
    const task = await ctx.db.get(taskId);
    if (!task || task.purpose !== "compaction" || task.status !== "completed" || !task.content.trim()) throw new Error("COMPACTION_EMPTY_OR_FAILED_RESULT");
    const input = JSON.parse(task.input) as {operationId: string; ordinal: number};
    return {operationId: input.operationId, ordinal: input.ordinal, text: task.content};
  },
});
export const run = durableWorkflow.define({
  args: {taskId: v.id("runtimeHelperTasks")}, returns: v.null(),
  handler: async (step, args): Promise<null> => {
    await step.runMutation(internal.chat.conversation_context_native.bind, {...args, workflowId: String(step.workflowId)});
    await runHelperWorkflowHandler(step, args);
    const result = await step.runMutation(internal.chat.conversation_context_native.result, args);
    await step.runMutation(internal.chat.conversation_context_mutations.commitChunk, {...result, operationId: result.operationId as import("../_generated/dataModel").Id<"conversationCompactions">});
    return null;
  },
});
