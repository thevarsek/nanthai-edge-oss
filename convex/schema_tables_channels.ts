import { telegramFile, telegramUploadedFile } from "./channels/telegram/media_types";
import { defineTable } from "convex/server";
import { v } from "convex/values";
import { runGenerationArgs } from "./chat/actions_args";

export const channelSchemaTables = {
  channelLinkGrants: defineTable({
    userId: v.string(), tokenHash: v.string(), botId: v.string(), expiresAt: v.number(),
    status: v.union(v.literal("pending"), v.literal("claimed"), v.literal("confirmed"), v.literal("revoked")),
    externalUserId: v.optional(v.string()), externalChatId: v.optional(v.string()),
    claimantName: v.optional(v.string()), createdAt: v.number(),
  }).index("by_user", ["userId"]).index("by_token", ["tokenHash"]),
  channelIdentities: defineTable({
    userId: v.string(), botId: v.string(), externalUserId: v.string(), externalChatId: v.string(),
    revision: v.number(), active: v.boolean(), createdAt: v.number(),
  }).index("by_user", ["userId"]).index("by_external", ["botId", "externalUserId"]),
  channelBindings: defineTable({
    userId: v.string(), identityId: v.id("channelIdentities"), chatId: v.id("chats"),
    personaId: v.optional(v.id("personas")), revision: v.number(), active: v.boolean(),
    deliverAfter: v.number(), createdAt: v.number(),
  }).index("by_user", ["userId"]).index("by_identity", ["identityId"]).index("by_chat", ["chatId"]),
  channelInbox: defineTable({
    userId: v.optional(v.string()), botId: v.string(), updateId: v.number(), externalUserId: v.string(),
    externalChatId: v.string(), externalMessageId: v.number(), text: v.string(), kind: v.string(),
    replyToId: v.optional(v.number()), identityId: v.optional(v.id("channelIdentities")),
    bindingId: v.optional(v.id("channelBindings")), bindingRevision: v.optional(v.number()),
    chatId: v.optional(v.id("chats")), canonicalMessageId: v.optional(v.id("messages")),
    admissionRunId: v.optional(v.id("executionRuns")),
    files: v.optional(v.array(telegramFile)), uploads: v.optional(v.array(telegramUploadedFile)),
    transcript: v.optional(v.string()), transcriptionCost: v.optional(v.object({modelId: v.string(), cost: v.number(), promptTokens: v.number(), completionTokens: v.number(), totalTokens: v.number(), generationId: v.optional(v.string())})),
    status: v.string(), error: v.optional(v.string()), late: v.boolean(), createdAt: v.number(),
  }).index("by_user", ["userId"]).index("by_update", ["botId", "updateId"])
    .index("by_external", ["botId", "externalChatId"]).index("by_chat", ["chatId"]).index("by_chat_status", ["chatId", "status"])
    .index("by_message", ["canonicalMessageId"]),
  channelDeliveries: defineTable({
    userId: v.optional(v.string()), identityId: v.optional(v.id("channelIdentities")),
    bindingId: v.optional(v.id("channelBindings")), bindingRevision: v.optional(v.number()),
    chatId: v.optional(v.id("chats")), sourceMessageId: v.optional(v.id("messages")),
    storageId: v.optional(v.id("_storage")), mimeType: v.optional(v.string()), kind: v.optional(v.union(v.literal("voice"),v.literal("audio_file"))),
    botId: v.string(), externalChatId: v.string(), dedupKey: v.string(), text: v.string(), part: v.number(),
    status: v.string(), attempt: v.number(), externalMessageId: v.optional(v.number()),
    error: v.optional(v.string()), retryAfter: v.optional(v.number()), createdAt: v.number(), updatedAt: v.number(),
    runId: v.optional(v.id("executionRuns")), attemptId: v.optional(v.id("executionAttempts")),
    fence: v.optional(v.number()),
  }).index("by_user", ["userId"]).index("by_chat", ["chatId"]).index("by_key", ["dedupKey"])
    .index("by_external_message", ["botId", "externalChatId", "externalMessageId"])
    .index("by_external_chat", ["botId", "externalChatId"]).index("by_external_status", ["botId", "externalChatId", "status"]),
  channelTurns: defineTable({
    userId: v.string(), chatId: v.id("chats"), userMessageId: v.id("messages"),
    generationJobId: v.optional(v.id("generationJobs")),
    generationArgs: v.object(runGenerationArgs), status: v.string(),
    workflowId: v.optional(v.string()), wakeEventId: v.optional(v.string()), createdAt: v.number(),
  }).index("by_user", ["userId"]).index("by_chat", ["chatId"]).index("by_message", ["userMessageId"]).index("by_generation_job", ["generationJobId"]).index("by_chat_status", ["chatId", "status"]).index("by_chat_status_createdAt", ["chatId", "status", "createdAt"]),
};
