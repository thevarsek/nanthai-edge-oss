import { MODEL_IDS } from "../lib/model_constants";

export const COLLABORATION_POLICY_VERSION = "collaboration-floor-v2";
export const COLLABORATION_SCHEDULER_VERSION = "collaboration-scheduler-v2";
export const COLLABORATION_SCHEDULER_MODEL = MODEL_IDS.collaborationScheduler;

export const COLLABORATION_MAX_WAVES = 5;
export const COLLABORATION_MAX_PARTICIPANT_MESSAGES = 8;
export const COLLABORATION_MAX_DURATION_MS = 10 * 60 * 1_000;

export const ACTIVE_COLLABORATION_STATUSES = new Set([
  "queued",
  "scheduling",
  "dispatching",
  "waiting",
] as const);
