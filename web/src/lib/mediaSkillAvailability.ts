export interface MediaSkillAvailability {
  profile: string;
  generationKind: "image" | "music" | "speech" | "video";
  modelId: string;
  isAvailable: boolean;
  reasonCode?: "selected_model_unavailable" | "zdr_incompatible_model";
}

export interface SkillWithMediaAvailability {
  mediaAvailability?: MediaSkillAvailability;
}

export function isMediaSkillUnavailable(
  skill: unknown,
): boolean {
  if (!skill || typeof skill !== "object" || !("mediaAvailability" in skill)) {
    return false;
  }
  const availability = (skill as SkillWithMediaAvailability).mediaAvailability;
  return availability?.isAvailable === false;
}

export function mediaSkillUnavailableMessageKey(
  skill: unknown,
): "skill_unavailable_model" | "skill_unavailable_zdr_model" {
  if (
    skill && typeof skill === "object" && "mediaAvailability" in skill &&
    (skill as SkillWithMediaAvailability).mediaAvailability?.reasonCode === "zdr_incompatible_model"
  ) {
    return "skill_unavailable_zdr_model";
  }
  return "skill_unavailable_model";
}
