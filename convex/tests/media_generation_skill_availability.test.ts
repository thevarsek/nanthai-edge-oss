import assert from "node:assert/strict";
import test from "node:test";

import { MODEL_IDS } from "../lib/model_constants";
import {
  IMAGE_GENERATION_SKILL,
  MUSIC_GENERATION_SKILL,
  SPEECH_GENERATION_SKILL,
  VIDEO_GENERATION_SKILL,
} from "../skills/catalog/media_generation";
import {
  availabilityForSkill,
  resolveMediaSkillAvailability,
} from "../skills/media_generation_availability";

function mockContext(args: {
  preferences: Record<string, unknown> | null;
  models?: Record<string, Record<string, unknown>>;
}) {
  return {
    db: {
      query: (table: string) => ({
        withIndex: (
          _index: string,
          apply: (query: { eq: (field: string, value: string) => unknown }) => unknown,
        ) => {
          let selected = "";
          const query = {
            eq: (_field: string, value: string) => {
              selected = value;
              return query;
            },
          };
          apply(query);
          return {
            first: async () => table === "userPreferences"
              ? args.preferences
              : args.models?.[selected] ?? null,
          };
        },
      }),
    },
  };
}

const defaultGenerationModels = {
  [MODEL_IDS.imageGeneration]: {
    modelId: MODEL_IDS.imageGeneration,
    supportsImages: true,
    imageCapabilities: { isAvailable: true },
  },
  [MODEL_IDS.musicGeneration]: {
    modelId: MODEL_IDS.musicGeneration,
    architecture: { modality: "text->audio" },
  },
  [MODEL_IDS.speechGeneration]: {
    modelId: MODEL_IDS.speechGeneration,
    architecture: { modality: "text->speech" },
  },
  [MODEL_IDS.videoGeneration]: {
    modelId: MODEL_IDS.videoGeneration,
    supportsVideo: true,
  },
};

test("media skill availability uses the single visible defaults when ZDR is off", async () => {
  const result = await resolveMediaSkillAvailability(
    mockContext({ preferences: null, models: defaultGenerationModels }) as never,
    "user_1",
  );

  assert.deepEqual(result.map((entry) => [entry.profile, entry.modelId, entry.isAvailable]), [
    ["imageGeneration", MODEL_IDS.imageGeneration, true],
    ["musicGeneration", MODEL_IDS.musicGeneration, true],
    ["speechGeneration", MODEL_IDS.speechGeneration, true],
    ["videoGeneration", MODEL_IDS.videoGeneration, true],
  ]);
});

test("media skill availability preserves selections and gates only incompatible ZDR profiles", async () => {
  const preferences = {
    zdrEnabled: true,
    defaultImageGenerationModelId: "image/zdr",
    defaultMusicGenerationModelId: "google/lyria-non-zdr",
    defaultSpeechGenerationModelId: "speech/zdr",
    defaultVideoGenerationModelId: "video/even-with-zdr-endpoint",
  };
  const result = await resolveMediaSkillAvailability(
    mockContext({
      preferences,
      models: {
        "image/zdr": {
          modelId: "image/zdr",
          supportsImages: true,
          hasZdrEndpoint: true,
          imageCapabilities: { isAvailable: true },
        },
        "google/lyria-non-zdr": {
          modelId: "google/lyria-non-zdr",
          architecture: { modality: "text->audio" },
          hasZdrEndpoint: false,
        },
        "speech/zdr": {
          modelId: "speech/zdr",
          architecture: { modality: "text->speech" },
          hasZdrEndpoint: true,
        },
        "video/even-with-zdr-endpoint": {
          modelId: "video/even-with-zdr-endpoint",
          supportsVideo: true,
          hasZdrEndpoint: true,
        },
      },
    }) as never,
    "user_1",
  );

  assert.deepEqual(result.map((entry) => ({
    profile: entry.profile,
    modelId: entry.modelId,
    isAvailable: entry.isAvailable,
    reasonCode: entry.reasonCode,
  })), [
    { profile: "imageGeneration", modelId: "image/zdr", isAvailable: false, reasonCode: "zdr_incompatible_model" },
    { profile: "musicGeneration", modelId: "google/lyria-non-zdr", isAvailable: false, reasonCode: "zdr_incompatible_model" },
    { profile: "speechGeneration", modelId: "speech/zdr", isAvailable: false, reasonCode: "zdr_incompatible_model" },
    { profile: "videoGeneration", modelId: "video/even-with-zdr-endpoint", isAvailable: false, reasonCode: "zdr_incompatible_model" },
  ]);

  const music = availabilityForSkill(
    { requiredToolProfiles: ["musicGeneration"] } as never,
    result,
  );
  assert.equal(music?.isAvailable, false);
});

test("media skill availability rejects a missing selected model without ZDR", async () => {
  const result = await resolveMediaSkillAvailability(
    mockContext({
      preferences: { defaultImageGenerationModelId: "image/retired" },
      models: defaultGenerationModels,
    }) as never,
    "user_1",
  );

  const image = result.find((entry) => entry.profile === "imageGeneration");
  assert.deepEqual(image, {
    profile: "imageGeneration",
    generationKind: "image",
    modelId: "image/retired",
    isAvailable: false,
    reasonCode: "selected_model_unavailable",
  });
  assert.equal(result.filter((entry) => entry.profile !== "imageGeneration").every(
    (entry) => entry.isAvailable,
  ), true);
});

test("forced protected turns gate media profiles even when the preference is off", async () => {
  const result = await resolveMediaSkillAvailability(
    mockContext({ preferences: { zdrEnabled: false }, models: {} }) as never,
    "user_1",
    undefined,
    true,
  );

  assert.equal(result.every((entry) => !entry.isAvailable), true);
});

test("media skill guides provide prompt anatomy, examples, persona direction, and capability projection", () => {
  const skills = [
    IMAGE_GENERATION_SKILL,
    MUSIC_GENERATION_SKILL,
    SPEECH_GENERATION_SKILL,
    VIDEO_GENERATION_SKILL,
  ];

  for (const skill of skills) {
    const instructions = skill.instructionsRaw ?? "";
    assert.match(instructions, /active persona's creative direction/);
    assert.match(instructions, /Example:/);
    assert.match(instructions, /backend (?:keeps|projects)/);
    assert.doesNotMatch(instructions, /omit optional/i);
  }

  assert.match(IMAGE_GENERATION_SKILL.instructionsRaw ?? "", /composition, framing, viewpoint/);
  assert.match(MUSIC_GENERATION_SKILL.instructionsRaw ?? "", /structural arc/);
  assert.match(SPEECH_GENERATION_SKILL.instructionsRaw ?? "", /pronunciation guidance/);
  assert.match(VIDEO_GENERATION_SKILL.instructionsRaw ?? "", /camera position and movement/);
});
