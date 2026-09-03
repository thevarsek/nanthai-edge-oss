import { describe, expect, it } from "vitest";
import {
  isMediaSkillUnavailable,
  mediaSkillUnavailableMessageKey,
} from "./mediaSkillAvailability";

describe("media skill availability", () => {
  it("treats only explicit backend unavailability as unavailable", () => {
    expect(isMediaSkillUnavailable({})).toBe(false);
    expect(isMediaSkillUnavailable({ mediaAvailability: {
      profile: "speechGeneration",
      generationKind: "speech",
      modelId: "speech/zdr",
      isAvailable: true,
    } })).toBe(false);
    expect(isMediaSkillUnavailable({ mediaAvailability: {
      profile: "musicGeneration",
      generationKind: "music",
      modelId: "music/non-zdr",
      isAvailable: false,
      reasonCode: "zdr_incompatible_model",
    } })).toBe(true);
  });

  it("selects a truthful warning for the backend reason", () => {
    expect(mediaSkillUnavailableMessageKey({ mediaAvailability: {
      profile: "imageGeneration",
      generationKind: "image",
      modelId: "image/retired",
      isAvailable: false,
      reasonCode: "selected_model_unavailable",
    } })).toBe("skill_unavailable_model");
    expect(mediaSkillUnavailableMessageKey({ mediaAvailability: {
      profile: "videoGeneration",
      generationKind: "video",
      modelId: "video/non-zdr",
      isAvailable: false,
      reasonCode: "zdr_incompatible_model",
    } })).toBe("skill_unavailable_zdr_model");
  });
});
