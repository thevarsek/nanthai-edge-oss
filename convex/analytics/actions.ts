"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { captureBackendAnalytics } from "./posthog";

const backendAnalyticsEventValidator = v.union(
  v.literal("assistant_response_started"),
  v.literal("assistant_response_completed"),
  v.literal("assistant_response_failed"),
  v.literal("message_continued"),
  v.literal("video_generation_requested"),
  v.literal("backend_ai_operation_started"),
  v.literal("backend_ai_operation_completed"),
  v.literal("backend_ai_operation_failed"),
);

const backendAnalyticsPropertyValidator = v.union(
  v.string(),
  v.number(),
  v.boolean(),
  v.null(),
);

export const captureBackendEvent = internalAction({
  args: {
    distinctId: v.string(),
    event: backendAnalyticsEventValidator,
    properties: v.optional(v.record(v.string(), backendAnalyticsPropertyValidator)),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    await captureBackendAnalytics(args.distinctId, args.event, args.properties ?? {});
    return null;
  },
});
