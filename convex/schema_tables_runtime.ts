import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
  sandboxSessionStatus,
  userCapability,
  userCapabilitySource,
  userCapabilityStatus,
} from "./schema_validators";

export const runtimeSchemaTables = {
  userCapabilities: defineTable({
    userId: v.string(),
    capability: userCapability,
    source: userCapabilitySource,
    status: userCapabilityStatus,
    grantedBy: v.optional(v.string()),
    grantedAt: v.number(),
    revokedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    metadata: v.optional(v.any()),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId", "status"])
    .index("by_user_capability", ["userId", "capability", "status"])
    .index("by_capability_status", ["capability", "status"]),

  sandboxSessions: defineTable({
    userId: v.string(),
    chatId: v.id("chats"),
    provider: v.literal("vercel"),
    providerSandboxId: v.optional(v.string()),
    status: sandboxSessionStatus,
    cwd: v.string(),
    lastActiveAt: v.number(),
    lastPausedAt: v.optional(v.number()),
    lastResumedAt: v.optional(v.number()),
    lastHealthcheckAt: v.optional(v.number()),
    timeoutMs: v.number(),
    internetEnabled: v.boolean(),
    publicTrafficEnabled: v.boolean(),
    pendingDeletionReason: v.optional(v.string()),
    failureCount: v.number(),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_chat", ["chatId"])
    .index("by_chat_user", ["chatId", "userId"])
    .index("by_user_status", ["userId", "status"])
    .index("by_status_last_active", ["status", "lastActiveAt"]),

  sandboxArtifacts: defineTable({
    userId: v.string(),
    chatId: v.id("chats"),
    sandboxSessionId: v.optional(v.id("sandboxSessions")),
    path: v.string(),
    filename: v.string(),
    mimeType: v.string(),
    sizeBytes: v.optional(v.number()),
    storageId: v.optional(v.id("_storage")),
    isDurable: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_chat", ["chatId", "createdAt"])
    .index("by_session", ["sandboxSessionId", "createdAt"]),

  sandboxEvents: defineTable({
    sandboxSessionId: v.optional(v.id("sandboxSessions")),
    userId: v.string(),
    chatId: v.id("chats"),
    eventType: v.string(),
    details: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_session", ["sandboxSessionId", "createdAt"])
    .index("by_chat", ["chatId", "createdAt"])
    .index("by_user", ["userId", "createdAt"]),
};
