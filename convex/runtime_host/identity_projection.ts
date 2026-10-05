import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { activePersonaRuntimeBinding, resolveEffectiveParticipantRoute } from "./route_resolution";

export type RuntimeIdentity = { runtimePlacement: "local" | "cloud"; runtimeAdapterId?: string; runtimeProvider?: string };

export async function personaRuntimeIdentity(ctx: QueryCtx, persona: Doc<"personas">): Promise<RuntimeIdentity> {
  const binding = await activePersonaRuntimeBinding(ctx, persona);
  return binding ? { runtimePlacement: "local", runtimeAdapterId: binding.adapterId,
    runtimeProvider: binding.provider ?? (binding.adapterId === "codex" ? "openai" : undefined) } : { runtimePlacement: "cloud" };
}

export async function chatParticipantIdentity(ctx: QueryCtx, participant: Doc<"chatParticipants">): Promise<RuntimeIdentity> {
  const route = await resolveEffectiveParticipantRoute(ctx, { userId: participant.userId, chatParticipantId: participant._id });
  if (route?.availability === "persona_unavailable") {
    // A deleted Persona has no next-turn route; retain its recorded identity for the list.
    const recorded = await ctx.db.query("chatParticipantRuntimeRoutes")
      .withIndex("by_participant_status", q => q.eq("chatParticipantId", participant._id).eq("status", "active")).unique();
    if (recorded) return { runtimePlacement: "local", runtimeAdapterId: recorded.adapterId,
      runtimeProvider: recorded.provider ?? (recorded.adapterId === "codex" ? "openai" : undefined) };
  }
  return { runtimePlacement: route?.placement ?? "cloud", runtimeAdapterId: route?.adapterId,
    runtimeProvider: route?.provider ?? (route?.adapterId === "codex" ? "openai" : undefined) };
}

export function connectionKind(participants: RuntimeIdentity[]): "local" | "openrouter" | "mixed" | null {
  if (!participants.length) return null;
  const local = participants.some(p => p.runtimePlacement === "local");
  const cloud = participants.some(p => p.runtimePlacement === "cloud");
  return local && cloud ? "mixed" : local ? "local" : "openrouter";
}
