import type { MutationCtx } from "../_generated/server";
import { resolveEffectiveParticipantRoute } from "../runtime_host/route_resolution";
import { wakeCollaboration } from "./wake_events";

/** Reconnect wakes the existing Workflow, without model polling or a cloud fallback. */
export async function wakeLocalCollaboration(ctx: MutationCtx, userId: string, deviceId: string) {
  const exchanges = await ctx.db.query("collaborationExchanges")
    .withIndex("by_user_wait", q => q.eq("userId", userId).eq("status", "waiting").eq("waitingReason", "runtime")).take(100);
  for (const exchange of exchanges) {
    for (const participant of exchange.participantSnapshot) {
      const route = await resolveEffectiveParticipantRoute(ctx, { userId, chatParticipantId: participant.participantId });
      if (route?.deviceId === deviceId && route.availability === "ready") {
        await wakeCollaboration(ctx, exchange._id); break;
      }
    }
  }
}
