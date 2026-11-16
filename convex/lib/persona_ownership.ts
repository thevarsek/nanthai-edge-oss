import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function assertOwnedPersonas(
  ctx: Pick<MutationCtx, "db">,
  userId: string,
  personaIds: Array<Id<"personas"> | undefined | null>,
): Promise<void> {
  for (const personaId of new Set(personaIds)) {
    if (!personaId) continue;
    const persona = await ctx.db.get(personaId);
    if (!persona || persona.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Persona not found." });
    }
  }
}
