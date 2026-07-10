import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, internalQuery } from "../_generated/server";

const CLEANUP_PAGE_SIZE = 100;

const pageArgs = {
  skillIds: v.array(v.id("skills")),
  cursor: v.optional(v.string()),
};

const pageResult = v.object({
  continueCursor: v.string(),
  isDone: v.boolean(),
  patchedCount: v.number(),
});

export const findRemovedSystemSkillIds = internalQuery({
  args: { slugs: v.array(v.string()) },
  returns: v.array(v.id("skills")),
  handler: async (ctx, args) => {
    const ids: Id<"skills">[] = [];
    for (const slug of args.slugs) {
      const candidates = await ctx.db
        .query("skills")
        .withIndex("by_slug", (query) => query.eq("slug", slug))
        .collect();
      for (const skill of candidates) {
        if (skill.scope === "system") ids.push(skill._id);
      }
    }
    return ids;
  },
});

/** Transitional phase: remove the retired profile while the schema still accepts it. */
export const cleanupLegacyAdvisorSkillProfilePage = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: pageResult,
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("skills")
      .paginate({ numItems: CLEANUP_PAGE_SIZE, cursor: args.cursor ?? null });
    let patchedCount = 0;
    for (const skill of result.page) {
      const profiles = skill.requiredToolProfiles ?? [];
      const nextProfiles = profiles.filter((profile) => String(profile) !== "advisor");
      if (nextProfiles.length === profiles.length) continue;
      await ctx.db.patch(skill._id, {
        requiredToolProfiles: nextProfiles,
        updatedAt: Date.now(),
      });
      patchedCount += 1;
    }
    return { ...paginationState(result), patchedCount };
  },
});

export const cleanupRemovedSkillPreferencesPage = internalMutation({
  args: pageArgs,
  returns: pageResult,
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("userPreferences")
      .paginate({ numItems: CLEANUP_PAGE_SIZE, cursor: args.cursor ?? null });
    const skillIdSet = new Set(args.skillIds.map(String));
    let patchedCount = 0;
    for (const preferences of result.page) {
      const filtered = filterSkillOverrides(preferences.skillDefaults, skillIdSet);
      if (!filtered.changed) continue;
      await ctx.db.patch(preferences._id, {
        skillDefaults: filtered.next,
        updatedAt: Date.now(),
      });
      patchedCount += 1;
    }
    return { ...paginationState(result), patchedCount };
  },
});

export const cleanupRemovedSkillPersonasPage = internalMutation({
  args: pageArgs,
  returns: pageResult,
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("personas")
      .paginate({ numItems: CLEANUP_PAGE_SIZE, cursor: args.cursor ?? null });
    const skillIdSet = new Set(args.skillIds.map(String));
    let patchedCount = 0;
    for (const persona of result.page) {
      const filtered = filterSkillOverrides(persona.skillOverrides, skillIdSet);
      if (!filtered.changed) continue;
      await ctx.db.patch(persona._id, {
        skillOverrides: filtered.next,
        updatedAt: Date.now(),
      });
      patchedCount += 1;
    }
    return { ...paginationState(result), patchedCount };
  },
});

export const cleanupRemovedSkillChatsPage = internalMutation({
  args: pageArgs,
  returns: pageResult,
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("chats")
      .paginate({ numItems: CLEANUP_PAGE_SIZE, cursor: args.cursor ?? null });
    const skillIdSet = new Set(args.skillIds.map(String));
    let patchedCount = 0;
    for (const chat of result.page) {
      const filtered = filterSkillOverrides(chat.skillOverrides, skillIdSet);
      if (!filtered.changed) continue;
      await ctx.db.patch(chat._id, {
        skillOverrides: filtered.next,
        updatedAt: Date.now(),
      });
      patchedCount += 1;
    }
    return { ...paginationState(result), patchedCount };
  },
});

export const cleanupRemovedSkillScheduledJobsPage = internalMutation({
  args: pageArgs,
  returns: pageResult,
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("scheduledJobs")
      .paginate({ numItems: CLEANUP_PAGE_SIZE, cursor: args.cursor ?? null });
    const skillIdSet = new Set(args.skillIds.map(String));
    let patchedCount = 0;
    for (const job of result.page) {
      const topLevel = filterSkillOverrides(job.turnSkillOverrides, skillIdSet);
      let stepsChanged = false;
      const nextSteps = job.steps?.map((step) => {
        const filtered = filterSkillOverrides(step.turnSkillOverrides, skillIdSet);
        if (!filtered.changed) return step;
        stepsChanged = true;
        return { ...step, turnSkillOverrides: filtered.next };
      });
      if (!topLevel.changed && !stepsChanged) continue;
      const updates: Partial<Doc<"scheduledJobs">> = { updatedAt: Date.now() };
      if (topLevel.changed) updates.turnSkillOverrides = topLevel.next;
      if (stepsChanged) updates.steps = nextSteps;
      await ctx.db.patch(job._id, updates);
      patchedCount += 1;
    }
    return { ...paginationState(result), patchedCount };
  },
});

export const deleteRemovedSystemSkillRows = internalMutation({
  args: { skillIds: v.array(v.id("skills")) },
  returns: v.object({ deletedCount: v.number() }),
  handler: async (ctx, args) => {
    let deletedCount = 0;
    for (const skillId of args.skillIds) {
      const skill = await ctx.db.get(skillId);
      if (!skill || skill.scope !== "system") continue;
      await ctx.db.delete(skill._id);
      deletedCount += 1;
    }
    return { deletedCount };
  },
});

function filterSkillOverrides<T extends { skillId: Id<"skills"> }>(
  entries: T[] | undefined,
  skillIdSet: Set<string>,
): { changed: boolean; next: T[] | undefined } {
  if (!entries || entries.length === 0) return { changed: false, next: entries };
  const next = entries.filter((entry) => !skillIdSet.has(String(entry.skillId)));
  return {
    changed: next.length !== entries.length,
    next: next.length > 0 ? next : undefined,
  };
}

function paginationState(result: { continueCursor: string; isDone: boolean }): {
  continueCursor: string;
  isDone: boolean;
} {
  return { continueCursor: result.continueCursor, isDone: result.isDone };
}
