"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { BACKEND_ANALYTICS_EVENTS } from "./backend_event_names";
import { captureBackendAnalytics } from "./posthog";

const backendAnalyticsEventValidator = v.union(
  ...BACKEND_ANALYTICS_EVENTS.map((event) => v.literal(event)),
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
