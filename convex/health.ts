// convex/health.ts
// Health check query — verifies deployment is live and auth is working.

import { query } from "./_generated/server";
import { optionalAuth } from "./lib/auth";

/**
 * Simple health check. Returns deployment status and optionally the
 * authenticated user's identity. Useful for iOS client connection verification.
 *
 * NOTE: No `timestamp` field — returning Date.now() would make the query
 * result different on every re-evaluation, causing spurious reactive updates
 * to every subscriber. The status + auth fields are sufficient and stable.
 */
export const check = query({
  args: {},
  handler: async (ctx) => {
    const user = await optionalAuth(ctx);
    return {
      status: "ok" as const,
      authenticated: user !== null,
      userId: user?.userId ?? null,
    };
  },
});
