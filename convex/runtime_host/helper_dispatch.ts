import { consumeLocalForget } from "../memory/decision_forget_local";
import { buildHelperPacket } from "./helper_packet";
import { v } from "convex/values";
import { internalAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { registerRuntimeTurnPacket } from "./turn_packets";
import { enqueueRuntimeHostCommand } from "./command_transport";
import { assertCurrentExecution } from "../execution/attempts";
import type { ExtractMemoriesArgs } from "../chat/actions_extract_memories_handler";
import type { GenerateTitleArgs } from "../chat/actions_generate_title_handler";
import { getCollaborationDecisionDeadline, assertCollaborationDecisionDeadline } from "./decision_deadline";

export const dispatch = internalAction({
  args: { taskId: v.id("runtimeHelperTasks") },
  returns: v.null(),
  handler: async (ctx, { taskId }) => {
    const context = await ctx.runQuery(internal.runtime_host.helper_tasks.get, { taskId });
    if (!context || context.task.status !== "waiting" || !context.attempt.deviceId || !context.attempt.chatParticipantId) throw new Error("LOCAL_HELPER_UNAVAILABLE");
    const { task, attempt, run, personaId } = context;
    const packet = await buildHelperPacket({ task, attempt, run, personaId });
    const commandId = packet.command.commandId;
    const blob = new Blob([JSON.stringify(packet)], { type: "application/json" });
    const storageId = await ctx.storage.store(blob);
    await ctx.runMutation(internal.runtime_host.helper_dispatch.commit, { taskId, commandId, storageId, packetHash: packet.command.packetHash, byteLength: blob.size });
    return null;
  },
});

export const commit = internalMutation({
  args: { taskId: v.id("runtimeHelperTasks"), commandId: v.string(), storageId: v.id("_storage"), packetHash: v.string(), byteLength: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task?.runId || task.status !== "waiting" || !task.attemptId || task.fence === undefined) throw new Error("LOCAL_HELPER_UNAVAILABLE");
    const { attempt, run } = await assertCurrentExecution(ctx, { attemptId: task.attemptId, fence: task.fence });
    if (!attempt.deviceId) throw new Error("LOCAL_HELPER_UNAVAILABLE");
    const deadlineAt = task.purpose === "decision" && run.parentRunId
      ? await getCollaborationDecisionDeadline(ctx, await ctx.db.get(run.parentRunId))
      : undefined;
    assertCollaborationDecisionDeadline(deadlineAt);
    const expiresAt = deadlineAt ?? Date.now() + 10 * 60 * 1000;
    const turnPacketId = await registerRuntimeTurnPacket(ctx, { ...args, userId: task.userId, runId: task.runId, attemptId: attempt._id, fence: attempt.fence, expiresAt });
    const commandRecordId = await enqueueRuntimeHostCommand(ctx, {
      runId: task.runId, attemptId: attempt._id, fence: attempt.fence, targetDeviceId: attempt.deviceId,
      commandId: args.commandId, type: "start", authorizationSource: "runtime_policy", initiatedBy: task.userId,
      payload: JSON.stringify({ threadName: `NanthAI ${task.purpose} helper` }), turnPacketId, expiresAt,
    });
    await ctx.db.patch(task._id, { commandRecordId });
    await ctx.scheduler.runAt(expiresAt, internal.runtime_host.helper_tasks.expire, { taskId: task._id });
    return null;
  },
});

export const consume = internalAction({
  args: { taskId: v.id("runtimeHelperTasks") },
  returns: v.null(),
  handler: async (ctx, { taskId }) => {
    if (!await ctx.runQuery(internal.runtime_host.helper_tasks.assertReady, { taskId })) throw new Error("LOCAL_HELPER_FENCED");
    const context = await ctx.runQuery(internal.runtime_host.helper_tasks.get, { taskId });
    if (!context) throw new Error("LOCAL_HELPER_UNAVAILABLE");
    const { task, attempt } = context;
    const execution = { runtimeHelperContent: task.content, executionAttemptId: attempt._id, executionFence: attempt.fence };
    if (task.purpose === "decision" || task.purpose === "compaction") return null;
    if (task.purpose === "forget") {
      await consumeLocalForget(ctx, task.input, task.content, { executionAttemptId: attempt._id, executionFence: attempt.fence });
    } else if (task.purpose === "memory") {
      await ctx.runAction(internal.chat.actions.extractMemories, { ...JSON.parse(task.input) as ExtractMemoriesArgs, ...execution });
    } else {
      await ctx.runAction(internal.chat.actions.generateTitle, { ...JSON.parse(task.input) as GenerateTitleArgs, ...execution });
    }
    return null;
  },
});
