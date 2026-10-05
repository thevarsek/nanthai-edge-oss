import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function removePersonaAdvisorAssignments(
  ctx: MutationCtx,
  personaId: Id<"personas">,
  userId: string,
): Promise<void> {
  const assignments = await ctx.db
    .query("chatAdvisors")
    .withIndex("by_persona", (query) => query.eq("personaId", personaId))
    .collect();
  for (const assignment of assignments) {
    if (assignment.userId === userId) await ctx.db.delete(assignment._id);
  }
}

export async function deletePersonaAvatarUnlessHistoricallyReferenced(
  ctx: MutationCtx,
  persona: { _id: Id<"personas">; avatarImageStorageId?: Id<"_storage"> },
): Promise<void> {
  if (!persona.avatarImageStorageId) return;
  const historicalRun = await ctx.db
    .query("advisorRuns")
    .withIndex("by_persona_avatar_storage", (query) =>
      query
        .eq("personaId", persona._id)
        .eq("personaAvatarStorageId", persona.avatarImageStorageId),
    )
    .first();
  if (!historicalRun) await ctx.storage.delete(persona.avatarImageStorageId);
}
