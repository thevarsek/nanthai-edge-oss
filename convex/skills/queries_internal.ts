// convex/skills/queries_internal.ts
// =============================================================================
// Internal-only queries used by skills actions.
// =============================================================================

import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

/**
 * Get a skill by its document ID. Used by the compilation action.
 */
export const getSkillById = internalQuery({
  args: { skillId: v.id("skills") },
  handler: async (ctx, { skillId }) => {
    return await ctx.db.get(skillId);
  },
});
