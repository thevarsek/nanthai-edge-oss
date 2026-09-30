import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { checkConsensusInternal } from "./actions_helpers";
import type { Id } from "../_generated/dataModel";
import { judgeDiscussion } from "./decision_helpers";

export async function finishAutonomousCycleHandler(
  ctx: ActionCtx,
  args: {
    sessionId: Id<"autonomousSessions">;
    cycle: number;
    userId: string;
    executionEpoch?: number;
  },
): Promise<"continue" | "terminal"> {
    const session = await ctx.runQuery(internal.autonomous.queries.getSession, {
      sessionId: args.sessionId,
    });
    if (!session || session.status !== "running" ||
        (args.executionEpoch !== undefined && session.executionEpoch !== args.executionEpoch)) {
      return "terminal";
    }
    if (session.autoStopOnConsensus) {
      const judgment = await judgeDiscussion(ctx, {
        chatId: session.chatId, userId: args.userId, parentMessageIds: session.parentMessageIds,
      });
      const consensus = judgment === null ? await checkConsensusInternal(
        ctx,
        session.chatId,
        session.turnOrder.length,
        args.userId,
      ) : judgment === "consensus";
      if (consensus || judgment === "stalled") {
        await ctx.runMutation(internal.autonomous.mutations.completeSession, {
          sessionId: args.sessionId,
          status: judgment === "stalled" ? "completed_stalled" : "completed_consensus",
          stopReason: judgment === "stalled" ? "Discussion stalled without progress" : "Consensus detected",
          executionEpoch: args.executionEpoch,
        });
        return "terminal";
      }
    }
    if (args.cycle >= session.maxCycles) {
      await ctx.runMutation(internal.autonomous.mutations.completeSession, {
        sessionId: args.sessionId,
        status: "completed_max_cycles",
        stopReason: "Max cycles reached",
        executionEpoch: args.executionEpoch,
      });
      return "terminal";
    }
    return "continue";
}
