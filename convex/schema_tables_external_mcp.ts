import { defineTable } from "convex/server";
import { v } from "convex/values";

export const externalMcpSchemaTables = {
  externalMcpClients: defineTable({ clientId: v.string(), name: v.string(), redirectUris: v.array(v.string()), createdAt: v.number() })
    .index("by_client", ["clientId"]).index("by_created", ["createdAt"]),
  externalMcpAuthorizations: defineTable({
    requestHash: v.string(), clientId: v.string(), redirectUri: v.string(), resource: v.string(),
    challenge: v.string(), state: v.optional(v.string()), scopes: v.array(v.string()), expiresAt: v.number(),
    userId: v.optional(v.string()), codeHash: v.optional(v.string()), codeExpiresAt: v.optional(v.number()), consumedAt: v.optional(v.number()),
    /** Grant issued from this code; a replayed code revokes it. */
    grantId: v.optional(v.id("externalMcpGrants")),
  }).index("by_request", ["requestHash"]).index("by_code", ["codeHash"]).index("by_user", ["userId"])
    .index("by_client", ["clientId"]).index("by_expiry", ["expiresAt"]),
  externalMcpGrants: defineTable({
    userId: v.string(), clientId: v.string(), name: v.string(), resource: v.string(), scopes: v.array(v.string()),
    accessHash: v.string(), accessScopes: v.array(v.string()), accessExpiresAt: v.number(), refreshHash: v.string(), createdAt: v.number(), revokedAt: v.optional(v.number()),
    /** Absolute refresh lifetime. Missing on older grants: createdAt + 90 days. */
    refreshExpiresAt: v.optional(v.number()),
    /** Last refresh. Missing on older grants: derived from accessExpiresAt. */
    lastUsedAt: v.optional(v.number()),
  }).index("by_access", ["accessHash"]).index("by_refresh", ["refreshHash"]).index("by_user", ["userId"]).index("by_client", ["clientId"]),
  /** Retired refresh-token hashes: grace-window retries and reuse detection. */
  externalMcpRefreshHistory: defineTable({
    userId: v.string(), grantId: v.id("externalMcpGrants"), refreshHash: v.string(), retiredAt: v.number(),
  }).index("by_hash", ["refreshHash"]).index("by_user", ["userId"]).index("by_retired", ["retiredAt"]),
  externalMcpReceipts: defineTable({ userId: v.string(), grantId: v.id("externalMcpGrants"), callId: v.string(), tool: v.string(), inputHash: v.string(), resultJson: v.string(), createdAt: v.number() })
    .index("by_call", ["grantId", "callId"]).index("by_user", ["userId"]),
};
