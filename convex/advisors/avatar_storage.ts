import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** Delete one historical run and reclaim its avatar once no durable owner remains. */
export async function deleteAdvisorRunAndReclaimAvatar(
  ctx: MutationCtx,
  run: Doc<"advisorRuns">,
): Promise<void> {
  await ctx.db.delete(run._id);
  if (!run.personaAvatarStorageId) return;

  const remainingRun = await ctx.db
    .query("advisorRuns")
    .withIndex("by_persona_avatar_storage", (query) =>
      query
        .eq("personaId", run.personaId)
        .eq("personaAvatarStorageId", run.personaAvatarStorageId)
    )
    .first();
  if (remainingRun) return;

  const persona = await ctx.db.get(run.personaId);
  if (persona?.avatarImageStorageId === run.personaAvatarStorageId) return;

  try {
    await ctx.storage.delete(run.personaAvatarStorageId);
  } catch {
    // The blob may already have been reclaimed by another cleanup path.
  }
}
