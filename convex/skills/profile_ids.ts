export const PROFILE_ORDER = [
  "presentations",
  "docs",
  "imageGeneration",
  "musicGeneration",
  "speechGeneration",
  "videoGeneration",
  "analytics",
  "workspace",
  "persistentRuntime",
  "subagents",
  "google",
  "microsoft",
  "notion",
  "appleCalendar",
  "cloze",
  "slack",
  "scheduledJobs",
  "skillsManagement",
  "personas",
] as const;

export type SkillToolProfileId = typeof PROFILE_ORDER[number];
