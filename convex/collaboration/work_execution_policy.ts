import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { resolveEffectiveParticipantRoute } from "../runtime_host/route_resolution";

/** Opt-in review enforcement is available on the cloud tool dispatcher.
 * Native adapter permissions are preserved; they are not a read-only guarantee. */
export async function workExecutionBlocker(ctx: MutationCtx, work: Doc<"collaborationWork">,
  participantId: Doc<"chatParticipants">["_id"]) {
  const route = await resolveEffectiveParticipantRoute(ctx, { userId: work.userId, chatParticipantId: participantId });
  if (!route || route.availability === "persona_unavailable") return "The assigned Persona is no longer available. Reassign this work.";
  if (route.placement !== "local") return null;
  if (route.availability !== "ready") return "Waiting for your Mac.";
  if (work.status === "review" && work.readOnlyReview) {
    return "This native adapter does not enforce read-only review. Choose a cloud reviewer or change the optional review policy.";
  }
  const device = await ctx.db.query("runtimeDevices")
    .withIndex("by_device_id", q => q.eq("deviceId", route.deviceId!)).unique();
  const presence = device?.currentPresenceId ? await ctx.db.get(device.currentPresenceId) : null;
  const adapter = presence?.adapters.find(row => row.adapterId === route.adapterId);
  if (!adapter?.capabilities.nanthaiCollaborationWork) return "Update NanthAI Runtime Host and reconnect to perform assigned work. Published results remain available.";
  return null;
}
