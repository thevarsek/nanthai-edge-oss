import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { MODEL_IDS } from "../lib/model_constants";
import {
  projectGenerationCapabilities,
  projectGenerationZdrCapabilities,
  type MediaGenerationKind,
} from "../models/generation_capabilities";
import type { SkillToolProfileId } from "./profile_ids";

export const MEDIA_GENERATION_PROFILES = [
  "imageGeneration",
  "musicGeneration",
  "speechGeneration",
  "videoGeneration",
] as const satisfies readonly SkillToolProfileId[];

export type MediaGenerationProfile = typeof MEDIA_GENERATION_PROFILES[number];

export interface MediaSkillAvailability {
  profile: MediaGenerationProfile;
  generationKind: MediaGenerationKind;
  modelId: string;
  isAvailable: boolean;
  reasonCode?: "selected_model_unavailable" | "zdr_incompatible_model";
}

type Preferences = Doc<"userPreferences"> | null;

const PROFILE_CONFIG: Record<MediaGenerationProfile, {
  generationKind: MediaGenerationKind;
  defaultModelId: string;
  preferenceKey:
    | "defaultImageGenerationModelId"
    | "defaultMusicGenerationModelId"
    | "defaultSpeechGenerationModelId"
    | "defaultVideoGenerationModelId";
}> = {
  imageGeneration: {
    generationKind: "image",
    defaultModelId: MODEL_IDS.imageGeneration,
    preferenceKey: "defaultImageGenerationModelId",
  },
  musicGeneration: {
    generationKind: "music",
    defaultModelId: MODEL_IDS.musicGeneration,
    preferenceKey: "defaultMusicGenerationModelId",
  },
  speechGeneration: {
    generationKind: "speech",
    defaultModelId: MODEL_IDS.speechGeneration,
    preferenceKey: "defaultSpeechGenerationModelId",
  },
  videoGeneration: {
    generationKind: "video",
    defaultModelId: MODEL_IDS.videoGeneration,
    preferenceKey: "defaultVideoGenerationModelId",
  },
};

export function mediaGenerationProfile(
  value: string,
): value is MediaGenerationProfile {
  return MEDIA_GENERATION_PROFILES.includes(value as MediaGenerationProfile);
}

export function mediaProfileForSkill(
  skill: Pick<Doc<"skills">, "requiredToolProfiles">,
): MediaGenerationProfile | null {
  return (skill.requiredToolProfiles ?? []).find(mediaGenerationProfile) ?? null;
}

export async function resolveMediaSkillAvailability(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  existingPreferences?: Preferences,
  requireZdrOverride?: boolean,
): Promise<MediaSkillAvailability[]> {
  const preferences = existingPreferences === undefined
    ? await ctx.db
        .query("userPreferences")
        .withIndex("by_user", (query) => query.eq("userId", userId))
        .first()
    : existingPreferences;

  const selected = MEDIA_GENERATION_PROFILES.map((profile) => {
    const config = PROFILE_CONFIG[profile];
    return {
      profile,
      config,
      modelId: preferences?.[config.preferenceKey] ?? config.defaultModelId,
    };
  });

  const requireZdr = requireZdrOverride ?? preferences?.zdrEnabled === true;
  const models = await Promise.all(selected.map(({ modelId }) =>
    ctx.db
      .query("cachedModels")
      .withIndex("by_modelId", (query) => query.eq("modelId", modelId))
      .first()
  ));

  return selected.map(({ profile, config, modelId }, index) => {
    const model = models[index];
    const supportsGeneration = model
      ? projectGenerationCapabilities(model)[config.generationKind]
      : false;
    const supportsRequiredPrivacy = !requireZdr || (
      model != null && projectGenerationZdrCapabilities(model)[config.generationKind]
    );
    const isAvailable = supportsGeneration && supportsRequiredPrivacy;
    const reasonCode = !supportsGeneration
      ? "selected_model_unavailable" as const
      : !supportsRequiredPrivacy
        ? "zdr_incompatible_model" as const
        : undefined;
    return {
      profile,
      generationKind: config.generationKind,
      modelId,
      isAvailable,
      ...(reasonCode ? { reasonCode } : {}),
    };
  });
}

export function availabilityForSkill(
  skill: Pick<Doc<"skills">, "requiredToolProfiles">,
  availability: MediaSkillAvailability[],
): MediaSkillAvailability | undefined {
  const profile = mediaProfileForSkill(skill);
  return profile
    ? availability.find((entry) => entry.profile === profile)
    : undefined;
}
