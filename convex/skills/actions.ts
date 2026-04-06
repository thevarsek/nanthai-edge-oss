// convex/skills/actions.ts
// =============================================================================
// Backend actions for the skills system.
//
// - seedSystemCatalog: Idempotent upsert of curated system skills
//
// Note: LLM compilation was removed in v1. Skills always serve instructionsRaw
// directly. The compilationStatus field is kept for schema compatibility but
// is always set to "compiled" on create/seed. See M18 milestone notes.
// =============================================================================

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";

// ---------------------------------------------------------------------------
// seedSystemCatalog — Idempotent upsert of curated system skills
// ---------------------------------------------------------------------------

export const seedSystemCatalog = internalAction({
  args: {},
  handler: async (ctx) => {
    // Dynamically import catalog constants to keep this file lightweight
    const { SYSTEM_SKILL_CATALOG } = await import("./catalog/index");

    for (const skillDef of SYSTEM_SKILL_CATALOG) {
      await ctx.runMutation(internal.skills.mutations_seed.upsertSystemSkill, {
        ...skillDef,
      });
    }

    console.info(
      `[skills/seed] Seeded ${SYSTEM_SKILL_CATALOG.length} system skills.`,
    );
  },
});
