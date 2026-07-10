import { deriveAnalyticsIdForClerkUserId } from "./analytics_id";

export type PostHogProperty = string | number | boolean | null | undefined;
export type PostHogProperties = Record<string, PostHogProperty>;

const DEFAULT_POSTHOG_HOST = "https://eu.i.posthog.com";
const POSTHOG_CAPTURE_PATH = "/i/v0/e/";
const POSTHOG_CAPTURE_TIMEOUT_MS = 1_500;
const SENSITIVE_IDENTITY_PROPERTY_KEYS = new Set([
  "$email",
  "$name",
  "clerkUserId",
  "clerk_user_id",
  "distinctId",
  "distinct_id",
  "email",
  "name",
  "userId",
  "user_id",
]);

export type BackendAnalyticsEvent =
  | "assistant_response_started"
  | "assistant_response_completed"
  | "assistant_response_failed"
  | "message_continued"
  | "video_generation_requested"
  | "advisor_consultation_started"
  | "advisor_consultation_completed"
  | "advisor_consultation_failed"
  | "advisor_kept_for_chat"
  | "advisor_removed_from_chat"
  | "backend_ai_operation_started"
  | "backend_ai_operation_completed"
  | "backend_ai_operation_failed";

export async function captureBackendAnalytics(
  clerkUserId: string,
  event: BackendAnalyticsEvent,
  properties: PostHogProperties = {},
): Promise<void> {
  try {
    const apiKey = configuredPostHogKey();
    if (!apiKey) return;
    const analyticsId = await deriveAnalyticsIdForClerkUserId(clerkUserId);
    if (!analyticsId) return;

    const host = process.env.POSTHOG_HOST || DEFAULT_POSTHOG_HOST;
    const normalizedHost = host.endsWith("/") ? host.slice(0, -1) : host;
    const sanitizedProperties = withoutSensitiveIdentityProperties(properties);

    await postPostHogEvent(normalizedHost, apiKey, analyticsId, event, {
      platform: "convex",
      app_surface: "backend",
      surface: "backend",
      ...sanitizedProperties,
    });

    const aiGenerationProperties = aiGenerationEventProperties(event, sanitizedProperties);
    if (aiGenerationProperties) {
      await postPostHogEvent(normalizedHost, apiKey, analyticsId, "$ai_generation", {
        platform: "convex",
        app_surface: "backend",
        surface: "backend",
        ...aiGenerationProperties,
      });
    }
  } catch (error) {
    console.warn("[analytics] PostHog capture threw", {
      event,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function configuredPostHogKey(): string | undefined {
  const candidates = [
    process.env.POSTHOG_PROJECT_API_KEY,
    process.env.POSTHOG_PROJECT_TOKEN,
  ];
  return candidates.find(isConfiguredPostHogKey);
}

function isConfiguredPostHogKey(key: string | undefined): key is string {
  const normalized = key?.trim().toLowerCase() ?? "";
  return normalized.startsWith("phc_") && !normalized.includes("your");
}

function withoutSensitiveIdentityProperties(
  properties: PostHogProperties,
): PostHogProperties {
  return Object.fromEntries(
    Object.entries(properties).filter(([key]) => !SENSITIVE_IDENTITY_PROPERTY_KEYS.has(key)),
  );
}

async function postPostHogEvent(
  normalizedHost: string,
  apiKey: string,
  distinctId: string,
  event: string,
  properties: PostHogProperties,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), POSTHOG_CAPTURE_TIMEOUT_MS);

  try {
    const response = await fetch(`${normalizedHost}${POSTHOG_CAPTURE_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        api_key: apiKey,
        event,
        distinct_id: distinctId,
        properties,
      }),
    });

    if (!response.ok) {
      console.warn("[analytics] PostHog capture failed", {
        event,
        status: response.status,
      });
    }
  } finally {
    clearTimeout(timeout);
  }
}

function aiGenerationEventProperties(
  event: BackendAnalyticsEvent,
  properties: PostHogProperties,
): PostHogProperties | null {
  if (event !== "assistant_response_completed" && event !== "assistant_response_failed") {
    return null;
  }

  return removeUndefinedProperties({
    "$ai_trace_id": firstStringProperty(properties, "chat_id", "job_id", "message_id", "openrouter_generation_id"),
    "$ai_session_id": stringProperty(properties, "chat_id"),
    "$ai_span_id": firstStringProperty(properties, "openrouter_generation_id", "job_id", "message_id"),
    "$ai_span_name": stringProperty(properties, "source") ?? event,
    "$ai_model": stringProperty(properties, "model_id"),
    "$ai_provider": "openrouter",
    "$ai_input_tokens": numberProperty(properties, "prompt_tokens"),
    "$ai_output_tokens": numberProperty(properties, "completion_tokens"),
    "$ai_total_cost_usd": numberProperty(properties, "cost_usd"),
    "$ai_latency": secondsProperty(properties, "duration_ms"),
    "$ai_time_to_first_token": secondsProperty(properties, "ttft_ms"),
    "$ai_stream": booleanProperty(properties, "stream") ?? true,
    "$ai_is_error": event === "assistant_response_failed",
    "$ai_error": event === "assistant_response_failed"
      ? stringProperty(properties, "failure_category")
      : undefined,
    "$ai_stop_reason": event === "assistant_response_failed"
      ? stringProperty(properties, "failure_category")
      : undefined,
    chat_id: stringProperty(properties, "chat_id"),
    message_id: stringProperty(properties, "message_id"),
    job_id: stringProperty(properties, "job_id"),
    openrouter_generation_id: stringProperty(properties, "openrouter_generation_id"),
    source: stringProperty(properties, "source"),
    origin_source: stringProperty(properties, "origin_source"),
    modality: stringProperty(properties, "modality"),
    endpoint: stringProperty(properties, "endpoint"),
    requested_image_count: numberProperty(properties, "requested_image_count"),
    image_count: numberProperty(properties, "image_count"),
    image_failed_count: numberProperty(properties, "image_failed_count"),
    image_partial_success: booleanProperty(properties, "image_partial_success"),
    image_config_present: booleanProperty(properties, "image_config_present"),
    image_config_applied: booleanProperty(properties, "image_config_applied"),
    image_config_count: numberProperty(properties, "image_config_count"),
    image_config_aspect_ratio: stringProperty(properties, "image_config_aspect_ratio"),
    image_config_resolution: stringProperty(properties, "image_config_resolution"),
    image_config_size: stringProperty(properties, "image_config_size"),
    image_config_quality: stringProperty(properties, "image_config_quality"),
    image_config_background: stringProperty(properties, "image_config_background"),
    image_config_output_format: stringProperty(properties, "image_config_output_format"),
    image_config_output_compression: numberProperty(
      properties,
      "image_config_output_compression",
    ),
    failure_category: stringProperty(properties, "failure_category"),
    client_platform: stringProperty(properties, "client_platform"),
    client_surface: stringProperty(properties, "client_surface"),
    total_tokens: numberProperty(properties, "total_tokens"),
    upstream_cost_usd: numberProperty(properties, "upstream_cost_usd"),
    openrouter_round_trip_duration_ms: numberProperty(properties, "openrouter_round_trip_duration_ms"),
    tool_round_count: numberProperty(properties, "tool_round_count"),
    tool_call_count: numberProperty(properties, "tool_call_count"),
  });
}

function stringProperty(properties: PostHogProperties, key: string): string | undefined {
  const value = properties[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function firstStringProperty(
  properties: PostHogProperties,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = stringProperty(properties, key);
    if (value) return value;
  }
  return undefined;
}

function numberProperty(properties: PostHogProperties, key: string): number | undefined {
  const value = properties[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanProperty(properties: PostHogProperties, key: string): boolean | undefined {
  const value = properties[key];
  return typeof value === "boolean" ? value : undefined;
}

function secondsProperty(properties: PostHogProperties, key: string): number | undefined {
  const value = numberProperty(properties, key);
  return value === undefined ? undefined : value / 1000;
}

function removeUndefinedProperties(properties: PostHogProperties): PostHogProperties {
  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined),
  );
}
