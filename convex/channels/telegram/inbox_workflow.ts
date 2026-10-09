import { vResultValidator } from "@convex-dev/workflow";
import { internalMutation } from "../../_generated/server";
import { reconcileOwnedWorkflowHandler } from "../../execution/workflow_lifecycle";
import { terminalizeExecution } from "../../execution/control_plane";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { durableWorkflow } from "../../execution/components";
import { wakeChannelTurns } from "../turn_queue";

export const run=durableWorkflow.define({
  args:{inboxId:v.id("channelInbox"),claimantName:v.string()},returns:v.null(),handler:async(step,args):Promise<null>=>{
    try {await step.runAction(internal.channels.telegram.media_actions.ingest,{inboxId:args.inboxId});await step.runMutation(internal.channels.telegram.admission.admit,args);}
    catch(error) {await step.runMutation(internal.channels.telegram.admission.fail,{inboxId:args.inboxId,error:error instanceof Error?error.message.split("\n")[0].replace(/^Uncaught Error: /, "").slice(0,1200):"Admission failed. Retry in NanthAI."});}
    return null;
  },
});

export const complete = internalMutation({
  args: {workflowId: v.string(), result: vResultValidator, context: v.object({inboxId: v.id("channelInbox"), runId: v.id("executionRuns")})},
  handler: async (ctx, args) => {
    await reconcileOwnedWorkflowHandler(ctx, {...args, context: {}});
    const run = await ctx.db.get(args.context.runId); const item = await ctx.db.get(args.context.inboxId);
    const interrupted = Boolean(item && run && item.admissionRunId === run._id && item.status === "received");
    if (interrupted && item) {
      await ctx.db.patch(item._id, {status: "failed", error: "Telegram admission was interrupted. Retry the retained input in NanthAI."});
      if (item.files?.length && item.canonicalMessageId) await ctx.db.patch(item.canonicalMessageId, {status: args.result.kind === "canceled" ? "cancelled" : "failed", inputProcessingNotice: "input_preparation_failed"});
      if (item.chatId) await wakeChannelTurns(ctx, item.chatId);
    }
    if (run?.activeAttemptId && !["completed", "failed", "cancelled"].includes(run.state)) {
      const attempt = await ctx.db.get(run.activeAttemptId);
      if (attempt) await terminalizeExecution(ctx, {attemptId: attempt._id, fence: attempt.fence,
        outcome: args.result.kind === "canceled" ? "cancelled" : interrupted || item?.status === "failed" || args.result.kind === "failed" ? "failed" : "completed",
        allowWaiting: true, allowExpiredLease: true});
    }
    return null;
  },
});
