import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
  contentReportKind,
  contentReportPlatform,
  contentReportReason,
  contentReportStatus,
} from "./content_reports/validators";

export const reportSchemaTables = {
  aiContentReports: defineTable({
    userId: v.string(),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    reason: contentReportReason,
    details: v.optional(v.string()),
    contentKinds: v.array(contentReportKind),
    contentSnapshot: v.optional(v.string()),
    imageUrls: v.array(v.string()),
    videoUrls: v.array(v.string()),
    attachmentSummaries: v.array(v.object({
      type: v.string(),
      name: v.optional(v.string()),
      mimeType: v.optional(v.string()),
    })),
    hasAudio: v.boolean(),
    modelId: v.optional(v.string()),
    participantName: v.optional(v.string()),
    sourceMessageStatus: v.string(),
    platform: contentReportPlatform,
    appVersion: v.optional(v.string()),
    buildNumber: v.optional(v.string()),
    status: contentReportStatus,
    reviewNote: v.optional(v.string()),
    reviewedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_user_message", ["userId", "messageId"])
    .index("by_chat", ["chatId", "createdAt"])
    .index("by_status_created", ["status", "createdAt"]),
};
