import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";

type MigrationCounts = {
  userPreferences: number;
  modelSettingsPatched: number;
  modelSettingsDeleted: number;
  favorites: number;
  personas: number;
  scheduledJobs: number;
  chatParticipants: number;
  messages: number;
  generationJobs: number;
  usageRecords: number;
  cachedModelsDeleted: number;
};

const DEFAULT_REPLACEMENT_MODEL_ID = "openai/gpt-4.1-mini";

export const migrateXaiModelReferences = internalMutation({
  args: {},
  handler: async (ctx): Promise<MigrationCounts> => {
    const now = Date.now();
    const replacementModelId = DEFAULT_REPLACEMENT_MODEL_ID;
    const counts: MigrationCounts = {
      userPreferences: 0,
      modelSettingsPatched: 0,
      modelSettingsDeleted: 0,
      favorites: 0,
      personas: 0,
      scheduledJobs: 0,
      chatParticipants: 0,
      messages: 0,
      generationJobs: 0,
      usageRecords: 0,
      cachedModelsDeleted: 0,
    };

    const userPreferences = await ctx.db.query("userPreferences").collect();
    for (const prefs of userPreferences) {
      const patch: Record<string, string | number | undefined> = {};
      if (isXaiModelId(prefs.defaultModelId)) {
        patch.defaultModelId = replacementModelId;
      }
      if (isXaiModelId(prefs.memoryExtractionModelId)) {
        patch.memoryExtractionModelId = replacementModelId;
      }
      if (isXaiModelId(prefs.titleModelId)) {
        patch.titleModelId = replacementModelId;
      }
      if (Object.keys(patch).length > 0) {
        patch.updatedAt = now;
        await ctx.db.patch(prefs._id, patch);
        counts.userPreferences += 1;
      }
    }

    const modelSettings = await ctx.db.query("modelSettings").collect();
    const claimedReplacementUsers = new Set(
      modelSettings
        .filter((setting) => setting.openRouterId === replacementModelId)
        .map((setting) => setting.userId),
    );
    for (const setting of modelSettings) {
      if (!isXaiModelId(setting.openRouterId)) continue;
      if (claimedReplacementUsers.has(setting.userId)) {
        await ctx.db.delete(setting._id);
        counts.modelSettingsDeleted += 1;
        continue;
      }
      await ctx.db.patch(setting._id, {
        openRouterId: replacementModelId,
        updatedAt: now,
      });
      claimedReplacementUsers.add(setting.userId);
      counts.modelSettingsPatched += 1;
    }

    const favorites = await ctx.db.query("favorites").collect();
    for (const favorite of favorites) {
      const nextModelIds = dedupeModelIds(
        favorite.modelIds.map((modelId) =>
          isXaiModelId(modelId) ? replacementModelId : modelId
        ),
      );
      if (!arraysEqual(favorite.modelIds, nextModelIds)) {
        await ctx.db.patch(favorite._id, {
          modelIds: nextModelIds,
          updatedAt: now,
        });
        counts.favorites += 1;
      }
    }

    const personas = await ctx.db.query("personas").collect();
    for (const persona of personas) {
      if (!isXaiModelId(persona.modelId)) continue;
      await ctx.db.patch(persona._id, {
        modelId: replacementModelId,
        updatedAt: now,
      });
      counts.personas += 1;
    }

    const scheduledJobs = await ctx.db.query("scheduledJobs").collect();
    for (const job of scheduledJobs) {
      const nextSteps = (job.steps ?? []).map((step) => ({
        ...step,
        modelId: isXaiModelId(step.modelId) ? replacementModelId : step.modelId,
      }));
      const shouldPatchJob =
        isXaiModelId(job.modelId) ||
        nextSteps.some((step, index) => step.modelId !== (job.steps ?? [])[index]?.modelId);
      if (!shouldPatchJob) continue;
      await ctx.db.patch(job._id, {
        modelId: isXaiModelId(job.modelId) ? replacementModelId : job.modelId,
        steps: nextSteps,
        updatedAt: now,
      });
      counts.scheduledJobs += 1;
    }

    counts.chatParticipants = await patchModelIdTable(
      ctx,
      "chatParticipants",
      replacementModelId,
    );
    counts.messages = await patchModelIdTable(ctx, "messages", replacementModelId);
    counts.generationJobs = await patchModelIdTable(
      ctx,
      "generationJobs",
      replacementModelId,
    );
    counts.usageRecords = await patchModelIdTable(
      ctx,
      "usageRecords",
      replacementModelId,
    );

    const cachedModels = await ctx.db
      .query("cachedModels")
      .withIndex("by_provider", (q) => q.eq("provider", "x-ai"))
      .collect();
    for (const model of cachedModels) {
      await ctx.db.delete(model._id);
      counts.cachedModelsDeleted += 1;
    }

    return counts;
  },
});

function isXaiModelId(modelId: string | undefined | null): boolean {
  return typeof modelId === "string" && modelId.startsWith("x-ai/");
}

function dedupeModelIds(modelIds: string[]): string[] {
  return Array.from(new Set(modelIds));
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

async function patchModelIdTable(
  ctx: MutationCtx,
  table: "chatParticipants" | "messages" | "generationJobs" | "usageRecords",
  replacementModelId: string,
): Promise<number> {
  const docs = await ctx.db.query(table).collect();
  let count = 0;
  for (const doc of docs) {
    if (!isXaiModelId(doc.modelId)) continue;
    await ctx.db.patch(doc._id, { modelId: replacementModelId });
    count += 1;
  }
  return count;
}

// ── M30: Migrate legacy skill/integration fields to new override format ──

type SkillIntegrationMigrationCounts = {
  personasSkillOverrides: number;
  personasIntegrationOverrides: number;
  chatsSkillOverrides: number;
  chatsIntegrationOverrides: number;
  personasLegacyCleared: number;
  chatsLegacyCleared: number;
};

/**
 * One-time migration: convert legacy skill/integration fields to the new
 * layered override format introduced in M30.
 *
 * - `persona.discoverableSkillIds: [A, B]` → `persona.skillOverrides: [{ skillId: A, state: "available" }, ...]`
 * - `persona.enabledIntegrations: ["gmail"]` → `persona.integrationOverrides: [{ integrationId: "gmail", enabled: true }]`
 * - `chat.discoverableSkillIds: [C]` → `chat.skillOverrides: [{ skillId: C, state: "available" }]`
 * - `chat.disabledSkillIds: [D]` → append `{ skillId: D, state: "never" }` to `chat.skillOverrides`
 *
 * Does NOT populate `userPreferences.skillDefaults` or `integrationDefaults` —
 * absence means system defaults apply, preserving current behavior.
 *
 * Safe to run multiple times (skips records that already have new fields populated).
 */
export const migrateSkillIntegrationOverrides = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, { dryRun }): Promise<SkillIntegrationMigrationCounts> => {
    const isDry = dryRun ?? false;
    const counts: SkillIntegrationMigrationCounts = {
      personasSkillOverrides: 0,
      personasIntegrationOverrides: 0,
      chatsSkillOverrides: 0,
      chatsIntegrationOverrides: 0,
      personasLegacyCleared: 0,
      chatsLegacyCleared: 0,
    };

    // ── Personas ──
    const personas = await ctx.db.query("personas").collect();
    for (const persona of personas) {
      const legacyPersona = persona as typeof persona & {
        discoverableSkillIds?: Id<"skills">[];
        enabledIntegrations?: string[];
      };
      const hasLegacyDiscoverable = Object.prototype.hasOwnProperty.call(legacyPersona, "discoverableSkillIds");
      const hasLegacyEnabledIntegrations = Object.prototype.hasOwnProperty.call(legacyPersona, "enabledIntegrations");
      // Skill overrides
      const discoIds = legacyPersona.discoverableSkillIds;
      if (discoIds && discoIds.length > 0 && (!persona.skillOverrides || persona.skillOverrides.length === 0)) {
        const overrides = discoIds.map((id) => ({
          skillId: id as Id<"skills">,
          state: "available" as const,
        }));
        if (!isDry) {
          await ctx.db.patch(persona._id, { skillOverrides: overrides });
        }
        counts.personasSkillOverrides += 1;
      }

      // Integration overrides
      const enabledInts = legacyPersona.enabledIntegrations;
      if (enabledInts && enabledInts.length > 0 && (!persona.integrationOverrides || persona.integrationOverrides.length === 0)) {
        const overrides = enabledInts.map((id) => ({
          integrationId: id,
          enabled: true,
        }));
        if (!isDry) {
          await ctx.db.patch(persona._id, { integrationOverrides: overrides });
        }
        counts.personasIntegrationOverrides += 1;
      }

      if (hasLegacyDiscoverable || hasLegacyEnabledIntegrations) {
        if (!isDry) {
          await ctx.db.patch(persona._id, {
            discoverableSkillIds: undefined,
            enabledIntegrations: undefined,
          } as never);
        }
        counts.personasLegacyCleared += 1;
      }
    }

    // ── Chats ──
    const chats = await ctx.db.query("chats").collect();
    for (const chat of chats) {
      const legacyChat = chat as typeof chat & {
        discoverableSkillIds?: Id<"skills">[];
        disabledSkillIds?: Id<"skills">[];
      };
      const hasLegacyDiscoverable = Object.prototype.hasOwnProperty.call(legacyChat, "discoverableSkillIds");
      const hasLegacyDisabled = Object.prototype.hasOwnProperty.call(legacyChat, "disabledSkillIds");
      const disco = legacyChat.discoverableSkillIds;
      const disabled = legacyChat.disabledSkillIds;
      const hasLegacy = (disco && disco.length > 0) || (disabled && disabled.length > 0);
      if (hasLegacy && (!chat.skillOverrides || chat.skillOverrides.length === 0)) {
        const overrides: Array<{ skillId: Id<"skills">; state: "available" | "never" }> = [];
        if (disco) {
          for (const id of disco) {
            overrides.push({ skillId: id as Id<"skills">, state: "available" });
          }
        }
        if (disabled) {
          for (const id of disabled) {
            // Only add if not already present from disco (shouldn't happen, but defensive)
            if (!overrides.some((o) => String(o.skillId) === String(id))) {
              overrides.push({ skillId: id as Id<"skills">, state: "never" });
            }
          }
        }
        if (overrides.length > 0) {
          if (!isDry) {
            await ctx.db.patch(chat._id, { skillOverrides: overrides });
          }
          counts.chatsSkillOverrides += 1;
        }
      }

      if (hasLegacyDiscoverable || hasLegacyDisabled) {
        if (!isDry) {
          await ctx.db.patch(chat._id, {
            discoverableSkillIds: undefined,
            disabledSkillIds: undefined,
          } as never);
        }
        counts.chatsLegacyCleared += 1;
      }

      // Chat integration overrides: chats didn't have persisted integration overrides
      // in the legacy model (they were ephemeral per-message), so nothing to migrate.
    }

    return counts;
  },
});
