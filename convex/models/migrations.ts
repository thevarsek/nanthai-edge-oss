import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";

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
