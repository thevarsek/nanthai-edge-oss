import type { Properties } from "posthog-js";
import { getAnalyticsConsent } from "@/lib/analyticsConsent";
import {
  isAllowedAnalyticsEnvironment,
  sanitizeAnalyticsProperties,
  sanitizeAutomaticUrlProperties,
  sanitizedPageUrl,
  stripQueryAndHash,
} from "@/lib/analyticsSanitization";

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? "https://eu.i.posthog.com";
const APP_VERSION = import.meta.env.VITE_APP_VERSION as string | undefined;
const BUILD_NUMBER = import.meta.env.VITE_BUILD_NUMBER as string | undefined;
const APP_PLATFORM = "web";

type PostHogClient = typeof import("posthog-js").default;
type PostHogIdentityState = PostHogClient & { _isIdentified?: () => boolean };

let client: PostHogClient | null = null;
let initialization: Promise<PostHogClient | null> | null = null;
let operationQueue = Promise.resolve();

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
  | "advisor_picker_opened"
  | "advisor_selected"
  | "advisor_consultation_started"
  | "advisor_consultation_completed"
  | "advisor_consultation_failed"
  | "advisor_kept_for_chat"
  | "advisor_removed_from_chat"
  | "advisor_advice_expanded"
  | "feature_used"
  | "cta_clicked"
  | "outbound_clicked";

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

function hasConfiguredPostHogKey(key: string | undefined): key is string {
  if (!key) return false;
  const normalized = key.trim().toLowerCase();
  return normalized.startsWith("phc_") && !normalized.includes("your");
}

function makeClientEventId(event: AnalyticsEvent | "$pageview"): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${event}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function applyReplayPreference(posthog: PostHogClient) {
  if (getAnalyticsConsent().sessionReplay) posthog.startSessionRecording();
  else posthog.stopSessionRecording();
}

export async function initAnalytics(): Promise<boolean> {
  if (client) {
    applyReplayPreference(client);
    return true;
  }
  if (initialization) return (await initialization) !== null;
  if (
    !getAnalyticsConsent().analytics
    || !hasConfiguredPostHogKey(POSTHOG_KEY)
    || !isAllowedAnalyticsEnvironment()
  ) return false;

  initialization = import("posthog-js").then(({ default: posthog }) => {
    if (!getAnalyticsConsent().analytics || !isAllowedAnalyticsEnvironment()) return null;
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      ui_host: "https://eu.posthog.com",
      defaults: "2026-05-30",
      person_profiles: "identified_only",
      capture_pageview: false,
      capture_pageleave: true,
      autocapture: false,
      capture_performance: { web_vitals: true },
      disable_session_recording: !getAnalyticsConsent().sessionReplay,
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
          if (url.includes("openrouter.ai") || url.includes("convex.cloud") || url.includes("/api/")) {
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
        if (!event || !getAnalyticsConsent().analytics || !isAllowedAnalyticsEnvironment()) return null;
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
    if (posthog.has_opted_out_capturing()) posthog.opt_in_capturing();
    applyReplayPreference(posthog);
    client = posthog;
    return posthog;
  }).finally(() => {
    initialization = null;
  });

  return (await initialization) !== null;
}

function enqueue(operation: (posthog: PostHogClient) => void) {
  if (!getAnalyticsConsent().analytics) return;
  operationQueue = operationQueue.then(async () => {
    if (!getAnalyticsConsent().analytics) return;
    if (!await initAnalytics() || !client) return;
    operation(client);
  });
}

export async function applyAnalyticsConsent(consent = getAnalyticsConsent()) {
  if (!consent.analytics) {
    if (client) {
      client.stopSessionRecording();
      client.reset();
      client.opt_out_capturing();
    }
    return;
  }

  if (await initAnalytics() && client) {
    if (client.has_opted_out_capturing()) client.opt_in_capturing();
    applyReplayPreference(client);
  }
}

export function createAnalyticsClientMetadata(
  event: AnalyticsEvent,
  routeOrScreen?: string,
): AnalyticsClientMetadata {
  const sanitizedRouteOrScreen = stripQueryAndHash(routeOrScreen);
  return {
    platform: APP_PLATFORM,
    surface: "web_app",
    clientEventId: makeClientEventId(event),
    clientSentAt: Date.now(),
    ...(APP_VERSION ? { appVersion: APP_VERSION } : {}),
    ...(BUILD_NUMBER ? { buildNumber: BUILD_NUMBER } : {}),
    ...(sanitizedRouteOrScreen ? { routeOrScreen: sanitizedRouteOrScreen } : {}),
  };
}

export function analyticsErrorLabel(error: unknown): string {
  if (error instanceof Error && error.name.trim().length > 0) return error.name.trim().toLowerCase();
  return "unknown_error";
}

export function isAnalyticsUserIdentified(): boolean {
  const identityState = client as PostHogIdentityState | null;
  return identityState?._isIdentified?.() === true;
}

export function identifyAnalyticsUser(analyticsId: string) {
  enqueue((posthog) => posthog.identify(analyticsId, { platform: APP_PLATFORM, surface: "web_app" }));
}

export function resetAnalyticsUser() {
  enqueue((posthog) => posthog.reset());
}

function commonProperties(event: AnalyticsEvent | "$pageview", properties: Properties) {
  return {
    platform: APP_PLATFORM,
    app_surface: "web_app",
    surface: "web_app",
    app_version: APP_VERSION,
    build_number: BUILD_NUMBER,
    environment: import.meta.env.MODE,
    client_event_id: makeClientEventId(event),
    client_sent_at: Date.now(),
    ...properties,
  };
}

export function capturePageview(pathname: string, searchPresent: boolean) {
  const path = stripQueryAndHash(pathname) ?? "/";
  enqueue((posthog) => posthog.capture("$pageview", commonProperties("$pageview", {
    $current_url: sanitizedPageUrl(path),
    $pathname: path,
    feature_area: "navigation",
    path,
    pathname: path,
    search_present: searchPresent,
  })));
}

export function captureAnalytics(event: AnalyticsEvent, properties: AnalyticsProperties = {}) {
  const sanitized = sanitizeAnalyticsProperties(properties);
  enqueue((posthog) => posthog.capture(event, commonProperties(event, {
    feature_area: sanitized.feature_area ?? "unknown",
    ...sanitized,
  })));
}

export function captureAnalyticsException(error: unknown, properties: AnalyticsProperties = {}) {
  const sanitized = sanitizeAnalyticsProperties(properties);
  const sanitizedError = new Error("redacted");
  sanitizedError.name = error instanceof Error && error.name.trim().length > 0
    ? error.name.trim()
    : "UnknownError";
  enqueue((posthog) => posthog.captureException(sanitizedError, commonProperties("app_ready", {
    feature_area: sanitized.feature_area ?? "error",
    ...sanitized,
    error_label: analyticsErrorLabel(error),
  })));
}
