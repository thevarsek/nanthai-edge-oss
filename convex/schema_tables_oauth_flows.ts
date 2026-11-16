import { defineTable } from "convex/server";
import { v } from "convex/values";

export const oauthFlowSchemaTables = {
  // Server-held state for one native Google Drive OnePick attempt. The client
  // receives an opaque relay handle (stored here only as a SHA-256 hash) and a
  // PKCE challenge; the verifier never leaves the backend. The handle lets the
  // signed-out mobile relay page fetch a picker token once, and the code
  // exchange consumes the row for the user who started the attempt.
  googleOnePickSessions: defineTable({
    userId: v.string(),
    handleHash: v.string(),
    encryptedPkceVerifier: v.string(),
    secretEnvelopeVersion: v.literal(2),
    secretKeyId: v.string(),
    redirectUri: v.string(),
    expiresAt: v.number(),
    relayRedeemedAt: v.optional(v.number()),
    consumedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_handle_hash", ["handleHash"])
    .index("by_user", ["userId", "createdAt"]),
};
