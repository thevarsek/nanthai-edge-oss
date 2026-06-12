import posthog from "posthog-js";
import type { Properties } from "posthog-js";

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? "https://eu.i.posthog.com";
const APP_VERSION = import.meta.env.VITE_APP_VERSION as string | undefined;
const BUILD_NUMBER = import.meta.env.VITE_BUILD_NUMBER as string | undefined;
const APP_PLATFORM = "web";

let initialized = false;

type PostHogIdentityState = typeof posthog & {
  _isIdentified?: () => boolean;
};

export type AnalyticsEvent =
  | "app_opened"
  | "app_ready"
  | "page_viewed"
  | "sign_in_started"
  | "sign_in_completed"
  | "sign_out"
  | "onboarding_started"
  | "onboarding_step_viewed"
  | "onboarding_completed"
  | "openrouter_connect_started"
  | "openrouter_connect_completed"
  | "openrouter_connect_failed"
  | "openrouter_disconnected"
  | "chat_created"
  | "chat_opened"
  | "message_send_attempted"
  | "message_sent"
  | "message_send_failed"
  | "message_retry_requested"
  | "message_retry_failed"
  | "response_copied"
  | "response_deleted"
  | "chat_exported"
  | "branch_created"
  | "message_continued"
  | "artifact_opened"
  | "artifact_downloaded"
  | "setting_changed"
  | "generation_cancelled"
  | "feature_used";

export type AnalyticsProperties = Properties;

export interface AnalyticsClientMetadata {
  platform: "web";
  appVersion?: string;
  buildNumber?: string;
  surface: string;
  routeOrScreen?: string;
  clientEventId: string;
  clientSentAt: number;
}

function makeClientEventId(event: AnalyticsEvent): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${event}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function hasConfiguredPostHogKey(key: string | undefined): key is string {
  if (!key) return false;
  const normalized = key.trim().toLowerCase();
  return normalized.startsWith("phc_") && !normalized.includes("your");
}

function stripQueryAndHash(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const queryIndex = value.indexOf("?");
  const hashIndex = value.indexOf("#");
  const candidates = [queryIndex, hashIndex].filter((index) => index >= 0);
  if (candidates.length === 0) return value;
  return value.slice(0, Math.min(...candidates));
}

function sanitizeAutomaticUrlProperties(properties: Properties) {
  for (const key of ["$current_url", "$initial_current_url", "$referrer", "$initial_referrer"]) {
    const sanitized = stripQueryAndHash(properties[key]);
    if (sanitized !== undefined) {
      properties[key] = sanitized;
    }
  }
}

export function createAnalyticsClientMetadata(
  event: AnalyticsEvent,
  routeOrScreen?: string,
): AnalyticsClientMetadata {
  return {
    platform: APP_PLATFORM,
    surface: "web_app",
    clientEventId: makeClientEventId(event),
    clientSentAt: Date.now(),
    ...(APP_VERSION ? { appVersion: APP_VERSION } : {}),
    ...(BUILD_NUMBER ? { buildNumber: BUILD_NUMBER } : {}),
    ...(routeOrScreen ? { routeOrScreen } : {}),
  };
}

export function analyticsErrorLabel(error: unknown): string {
  if (error instanceof Error && error.name.trim().length > 0) {
    return error.name.trim().toLowerCase();
  }
  return "unknown_error";
}

export function initAnalytics() {
  if (initialized || !hasConfiguredPostHogKey(POSTHOG_KEY) || typeof window === "undefined") return;

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    ui_host: "https://eu.posthog.com",
    person_profiles: "identified_only",
    capture_pageview: false,
    capture_pageleave: true,
    autocapture: true,
    capture_performance: {
      web_vitals: true,
    },
    mask_all_text: true,
    mask_all_element_attributes: true,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: ".ph-mask, [data-ph-mask]",
      blockSelector: ".ph-block, [data-ph-block]",
      recordBody: false,
      recordHeaders: false,
      maskCapturedNetworkRequestFn: (request) => {
        const url = request.name.toLowerCase();
        if (
          url.includes("openrouter.ai") ||
          url.includes("convex.cloud") ||
          url.includes("/api/")
        ) {
          return undefined;
        }
        return {
          ...request,
          name: stripQueryAndHash(request.name) ?? request.name,
          requestBody: undefined,
          responseBody: undefined,
          requestHeaders: undefined,
          responseHeaders: undefined,
        };
      },
    },
    enable_recording_console_log: false,
    before_send: (event) => {
      if (!event) return event;
      if (event.properties) {
        delete event.properties.$elements;
        delete event.properties.$elements_chain;
        delete event.properties.$el_text;
        delete event.properties.$element_text;
        delete event.properties.$external_click_url;
        sanitizeAutomaticUrlProperties(event.properties);
      }
      return event;
    },
  });

  initialized = true;
}

export function isAnalyticsUserIdentified(): boolean {
  if (!initialized) return false;
  const identityState = posthog as PostHogIdentityState;
  return identityState._isIdentified?.() === true;
}

export function identifyAnalyticsUser(analyticsId: string) {
  if (!initialized) return;
  posthog.identify(analyticsId, {
    platform: APP_PLATFORM,
    surface: "web_app",
  });
}

export function resetAnalyticsUser() {
  if (!initialized) return;
  posthog.reset();
}

export function captureAnalytics(
  event: AnalyticsEvent,
  properties: AnalyticsProperties = {},
) {
  if (!initialized) return;
  posthog.capture(event, {
    platform: APP_PLATFORM,
    app_surface: "web_app",
    surface: "web_app",
    app_version: APP_VERSION,
    build_number: BUILD_NUMBER,
    environment: import.meta.env.MODE,
    feature_area: properties.feature_area ?? "unknown",
    client_event_id: makeClientEventId(event),
    client_sent_at: Date.now(),
    ...properties,
  });
}

export function captureAnalyticsException(
  error: unknown,
  properties: AnalyticsProperties = {},
) {
  if (!initialized) return;
  const sanitizedError = new Error("redacted");
  sanitizedError.name = error instanceof Error && error.name.trim().length > 0
    ? error.name.trim()
    : "UnknownError";
  posthog.captureException(sanitizedError, {
    platform: APP_PLATFORM,
    app_surface: "web_app",
    surface: "web_app",
    app_version: APP_VERSION,
    build_number: BUILD_NUMBER,
    environment: import.meta.env.MODE,
    feature_area: properties.feature_area ?? "error",
    ...properties,
    error_label: analyticsErrorLabel(error),
  });
}
