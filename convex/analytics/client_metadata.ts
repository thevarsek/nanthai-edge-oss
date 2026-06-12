import { v } from "convex/values";

export const analyticsClientMetadataValidator = v.object({
  platform: v.union(v.literal("web"), v.literal("ios"), v.literal("android")),
  appVersion: v.optional(v.string()),
  buildNumber: v.optional(v.string()),
  surface: v.optional(v.string()),
  routeOrScreen: v.optional(v.string()),
  clientEventId: v.optional(v.string()),
  clientSentAt: v.optional(v.number()),
});

export interface AnalyticsClientMetadata {
  platform: "web" | "ios" | "android";
  appVersion?: string;
  buildNumber?: string;
  surface?: string;
  routeOrScreen?: string;
  clientEventId?: string;
  clientSentAt?: number;
}

export function analyticsClientProperties(metadata?: AnalyticsClientMetadata) {
  return {
    client_platform: metadata?.platform ?? null,
    app_version: metadata?.appVersion ?? null,
    build_number: metadata?.buildNumber ?? null,
    client_app_version: metadata?.appVersion ?? null,
    client_build_number: metadata?.buildNumber ?? null,
    client_surface: metadata?.surface ?? null,
    client_route_or_screen: metadata?.routeOrScreen ?? null,
    client_event_id: metadata?.clientEventId ?? null,
    client_sent_at: metadata?.clientSentAt ?? null,
  };
}
