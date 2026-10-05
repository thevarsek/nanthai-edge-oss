import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** First-run local setup selects its starter once; later pairing and user edits keep their defaults. */
export async function selectLocalOnboardingDefault(
  ctx: MutationCtx,
  userId: string,
  personaId: Id<"personas">,
  now: number,
): Promise<void> {
  const prefs = await ctx.db.query("userPreferences").withIndex("by_user", (q) => q.eq("userId", userId)).first();
  if (!prefs || prefs.onboardingCompleted || prefs.runtimeOnboardingState !== "setup" || prefs.runtimeOnboardingDefaultAssigned || prefs.defaultPersonaId) return;
  const persona = await ctx.db.get(personaId);
  if (!persona || persona.userId !== userId) return;
  await ctx.db.patch(prefs._id, {
    defaultPersonaId: personaId,
    runtimeOnboardingDefaultAssigned: true,
    updatedAt: now,
  });
}

