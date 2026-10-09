import { v } from "convex/values";
import type { DataModel, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { backgroundWorkpool } from "../execution/components";
import { terminalizeExecution } from "../execution/control_plane";
import { terminalizeExecutionComponentByOperation } from "../execution/component_refs";
import { dispatchNextDelivery } from "./delivery_queue";

const context=v.object({deliveryId:v.id("channelDeliveries"),runId:v.id("executionRuns")});
export const complete=backgroundWorkpool.defineOnComplete<DataModel,typeof context>({
  context,handler:async(ctx,args)=>{
    await settleTelegramDelivery(ctx, args.context.deliveryId, args.context.runId, String(args.workId), args.result.kind === "success" ? "completed" : args.result.kind === "canceled" ? "cancelled" : "failed");
  },
});

export async function settleTelegramDelivery(ctx: MutationCtx, deliveryId: Id<"channelDeliveries">, runId: Id<"executionRuns">, operationId: string, outcome: "completed" | "cancelled" | "failed") {
    const item=await ctx.db.get(deliveryId); const run=await ctx.db.get(runId);
    if (item && item.runId === runId && ["scheduled","sending"].includes(item.status)) await ctx.db.patch(item._id,{status:item.status==="sending"?"unknown":"failed",error:"Delivery interrupted. Inspect the result before resending.",updatedAt:Date.now()});
    if (run?.activeAttemptId&&!['completed','failed','cancelled'].includes(run.state)) {
      const attempt=await ctx.db.get(run.activeAttemptId);
      if (attempt) await terminalizeExecution(ctx,{attemptId:attempt._id,fence:attempt.fence,outcome:outcome,allowExpiredLease:true});
    }
    await terminalizeExecutionComponentByOperation(ctx,"background-workpool",operationId,outcome);
    if (item) await dispatchNextDelivery(ctx,item.botId,item.externalChatId);
}
