import { ConvexError } from "convex/values";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

function normalizedPersonaDisplayName(displayName: string): string {
  return displayName.trim().toLowerCase();
}

/** Use the same owner-scoped naming rule for automatically provisioned Personas. */
export async function availablePersonaDisplayName(
  ctx: MutationCtx,
  userId: string,
  baseName: string,
): Promise<string> {
  const personas = await ctx.db.query("personas")
    .withIndex("by_user", (query) => query.eq("userId", userId)).collect();
  const names = new Set(personas.map((persona) => normalizedPersonaDisplayName(persona.displayName)));
  let name = baseName;
  for (let suffix = 2; names.has(normalizedPersonaDisplayName(name)); suffix += 1) {
    name = `${baseName} (${suffix})`;
  }
  return name;
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
