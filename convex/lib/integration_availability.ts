// convex/lib/integration_availability.ts
// =============================================================================
// Server-side availability for integrations that clients can hide.
//
// Clients hide an unavailable integration's connect flow; the backend refuses
// the same integration's connect exchange and tools, so building the URL by
// hand does not bypass the product decision. Disconnecting an existing
// connection always stays available.
// =============================================================================

import { ConvexError } from "convex/values";

type Env = Record<string, string | undefined>;

export const SLACK_UNAVAILABLE_MESSAGE = "Slack is not available in NanthAI right now.";

/** Slack is unavailable unless SLACK_INTEGRATION_AVAILABLE=true on the deployment. */
export function isSlackIntegrationAvailable(env: Env = process.env): boolean {
  return env.SLACK_INTEGRATION_AVAILABLE?.trim() === "true";
}

export function assertSlackIntegrationAvailable(env: Env = process.env): void {
  if (!isSlackIntegrationAvailable(env)) {
    throw new ConvexError({ code: "INTEGRATION_UNAVAILABLE" as const, message: SLACK_UNAVAILABLE_MESSAGE });
  }
}
