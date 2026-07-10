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

import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { FunctionReference } from "convex/server";
import type { Id } from "../_generated/dataModel";

type CleanupPageResult = {
  continueCursor: string;
  isDone: boolean;
  patchedCount: number;
};

type LegacyCleanupPageRef = FunctionReference<
  "mutation",
  "internal",
  { cursor?: string },
  CleanupPageResult
>;

type ReferenceCleanupPageRef = FunctionReference<
  "mutation",
  "internal",
  { skillIds: Id<"skills">[]; cursor?: string },
  CleanupPageResult
>;

type FindRemovedSkillsRef = FunctionReference<
  "query",
  "internal",
  { slugs: string[] },
  Id<"skills">[]
>;

type DeleteRemovedSkillsRef = FunctionReference<
  "mutation",
  "internal",
  { skillIds: Id<"skills">[] },
  { deletedCount: number }
>;

// ---------------------------------------------------------------------------
// seedSystemCatalog — Idempotent upsert of curated system skills
// ---------------------------------------------------------------------------

export const seedSystemCatalog = internalAction({
  args: {},
  handler: async (ctx) => {
    // Dynamically import catalog constants to keep this file lightweight
    const {
      REMOVED_SYSTEM_SKILL_SLUGS,
      SYSTEM_SKILL_CATALOG,
    } = await import("./catalog/index");

    for (const skillDef of SYSTEM_SKILL_CATALOG) {
      await ctx.runMutation(internal.skills.mutations_seed.upsertSystemSkill, {
        ...skillDef,
      });
    }

    const cleanup = cleanupReferences();
    await drainLegacyProfileCleanup(ctx, cleanup.cleanupLegacyAdvisorSkillProfilePage);

    if (REMOVED_SYSTEM_SKILL_SLUGS.length > 0) {
      const skillIds = await ctx.runQuery(cleanup.findRemovedSystemSkillIds, {
        slugs: [...REMOVED_SYSTEM_SKILL_SLUGS],
      });
      if (skillIds.length > 0) {
        for (const cleanupPage of cleanup.referencePages) {
          await drainReferenceCleanup(ctx, cleanupPage, skillIds);
        }
        await ctx.runMutation(cleanup.deleteRemovedSystemSkillRows, { skillIds });
      }
    }

    console.info(
      `[skills/seed] Seeded ${SYSTEM_SKILL_CATALOG.length} system skills.`,
    );
  },
});

function cleanupReferences(): {
  cleanupLegacyAdvisorSkillProfilePage: LegacyCleanupPageRef;
  findRemovedSystemSkillIds: FindRemovedSkillsRef;
  referencePages: ReferenceCleanupPageRef[];
  deleteRemovedSystemSkillRows: DeleteRemovedSkillsRef;
} {
  const cleanup = (internal as unknown as {
    skills: {
      mutations_seed_cleanup: {
        cleanupLegacyAdvisorSkillProfilePage: LegacyCleanupPageRef;
        findRemovedSystemSkillIds: FindRemovedSkillsRef;
        cleanupRemovedSkillPreferencesPage: ReferenceCleanupPageRef;
        cleanupRemovedSkillPersonasPage: ReferenceCleanupPageRef;
        cleanupRemovedSkillChatsPage: ReferenceCleanupPageRef;
        cleanupRemovedSkillScheduledJobsPage: ReferenceCleanupPageRef;
        deleteRemovedSystemSkillRows: DeleteRemovedSkillsRef;
      };
    };
  }).skills.mutations_seed_cleanup;
  return {
    cleanupLegacyAdvisorSkillProfilePage: cleanup.cleanupLegacyAdvisorSkillProfilePage,
    findRemovedSystemSkillIds: cleanup.findRemovedSystemSkillIds,
    referencePages: [
      cleanup.cleanupRemovedSkillPreferencesPage,
      cleanup.cleanupRemovedSkillPersonasPage,
      cleanup.cleanupRemovedSkillChatsPage,
      cleanup.cleanupRemovedSkillScheduledJobsPage,
    ],
    deleteRemovedSystemSkillRows: cleanup.deleteRemovedSystemSkillRows,
  };
}

async function drainLegacyProfileCleanup(
  ctx: ActionCtx,
  cleanupPage: LegacyCleanupPageRef,
): Promise<void> {
  let cursor: string | undefined;
  do {
    const result = await ctx.runMutation(cleanupPage, { cursor });
    cursor = result.isDone ? undefined : result.continueCursor;
    if (result.isDone) return;
  } while (cursor);
}

async function drainReferenceCleanup(
  ctx: ActionCtx,
  cleanupPage: ReferenceCleanupPageRef,
  skillIds: Id<"skills">[],
): Promise<void> {
  let cursor: string | undefined;
  do {
    const result = await ctx.runMutation(cleanupPage, { skillIds, cursor });
    cursor = result.isDone ? undefined : result.continueCursor;
    if (result.isDone) return;
  } while (cursor);
}
