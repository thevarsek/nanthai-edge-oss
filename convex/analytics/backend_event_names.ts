export const BACKEND_ANALYTICS_EVENTS = [
  "assistant_response_started",
  "assistant_response_first_patch",
  "assistant_response_completed",
  "assistant_response_failed",
  "message_continued",
  "video_generation_requested",
  "advisor_consultation_started",
  "advisor_consultation_completed",
  "advisor_consultation_failed",
  "advisor_kept_for_chat",
  "advisor_removed_from_chat",
  "backend_ai_operation_started",
  "backend_ai_operation_completed",
  "backend_ai_operation_failed",
] as const;

export type BackendAnalyticsEvent = typeof BACKEND_ANALYTICS_EVENTS[number];
