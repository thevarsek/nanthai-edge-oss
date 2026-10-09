import { v } from "convex/values";
import type { EventId } from "@convex-dev/workflow";
import { internal } from "../_generated/api";
import { durableWorkflow } from "../execution/components";

export const run=durableWorkflow.define({
  args:{turnId:v.id("channelTurns")},returns:v.null(),handler:async(step,args):Promise<null>=>{
    while (true) {
      const next=await step.runMutation(internal.channels.turn_queue.advance,args);
      if (next.done) return null;
      if (!next.eventId) throw new Error("CHANNEL_TURN_EVENT_MISSING");
      await step.awaitEvent({id:next.eventId as EventId<string>,validator:v.null()});
    }
  },
});
