import { ConvexError } from "convex/values";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

function normalizedPersonaDisplayName(displayName: string): string {
  return displayName.trim().toLowerCase();
}

export async function assertUniquePersonaDisplayName(
  ctx: MutationCtx,
  userId: string,
  displayName: string,
  excludingPersonaId?: Id<"personas">,
): Promise<void> {
  const normalizedName = normalizedPersonaDisplayName(displayName);
  const personas = await ctx.db
    .query("personas")
    .withIndex("by_user", (query) => query.eq("userId", userId))
    .collect();
  const duplicate = personas.some(
    (persona) =>
      persona._id !== excludingPersonaId
      && typeof persona.displayName === "string"
      && normalizedPersonaDisplayName(persona.displayName) === normalizedName,
  );
  if (duplicate) {
    throw new ConvexError({
      code: "DUPLICATE_PERSONA_NAME",
      message: `A persona named "${displayName.trim()}" already exists. Choose a different name.`,
    });
  }
}
