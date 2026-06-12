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
          distinct_id: analyticsId,
          properties: {
            platform: "convex",
            app_surface: "backend",
            surface: "backend",
            ...withoutSensitiveIdentityProperties(properties),
          },
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
