import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
  toolConfirmationKind,
  toolConfirmationStatus,
} from "./tool_confirmations/validators";

export const toolConfirmationSchemaTables = {
  /**
   * Durable user confirmation for one consequential tool call. The owning
   * generation Workflow waits on its deferred checkpoint; approval issues a
   * single-use grant for the exact tool name and canonical input hash.
   */
  toolConfirmationRequests: defineTable({
    userId: v.string(),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    generationJobId: v.id("generationJobs"),
    runId: v.optional(v.id("executionRuns")),
    attemptId: v.id("executionAttempts"),
    fence: v.number(),
    toolCallId: v.string(),
    toolName: v.string(),
    inputHash: v.string(),
    kind: toolConfirmationKind,
    summary: v.string(),
    detail: v.optional(v.string()),
    recipients: v.array(v.string()),
    integrations: v.array(v.string()),
    status: toolConfirmationStatus,
    decisionSource: v.optional(v.union(v.literal("user"), v.literal("timeout"), v.literal("system"))),
    checkpointBound: v.boolean(),
    deliveredAt: v.optional(v.number()),
    decidedAt: v.optional(v.number()),
    grantExpiresAt: v.optional(v.number()),
    grantConsumedAt: v.optional(v.number()),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_chat_status", ["userId", "chatId", "status", "createdAt"])
    .index("by_job_tool_call", ["generationJobId", "toolCallId"])
    .index("by_job_grant", ["generationJobId", "toolName", "inputHash", "status"])
    .index("by_run", ["runId"])
    .index("by_chat", ["chatId"]),
};
