import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
  runtimePermissionDecision,
  runtimePermissionStatus,
} from "./runtime_host/permission_validators";

export const runtimePermissionSchemaTables = {
  runtimePermissionRequests: defineTable({
    userId: v.string(),
    chatId: v.id("chats"),
    generationJobId: v.optional(v.id("generationJobs")),
    runId: v.id("executionRuns"),
    attemptId: v.id("executionAttempts"),
    fence: v.number(),
    primaryCommandRecordId: v.id("runtimeCommands"),
    requestEventId: v.string(),
    requestEventSequence: v.number(),
    permissionRequestId: v.string(),
    nativeAgentThreadId: v.optional(v.string()),
    toolCallId: v.optional(v.string()),
    permissionKind: v.string(),
    inputSchema: v.optional(v.string()),
    automaticResponseAt: v.optional(v.number()),
    responseSource: v.optional(v.union(v.literal("user"), v.literal("automatic"))),
    inputResponseHash: v.optional(v.string()),
    inputOutcome: v.optional(v.union(v.literal("submitted"), v.literal("cancelled"))),
    prompt: v.string(),
    choices: v.array(runtimePermissionDecision),
    expiresAt: v.optional(v.number()),
    status: runtimePermissionStatus,
    requestedDecision: v.optional(runtimePermissionDecision),
    responseCommandRecordId: v.optional(v.id("runtimeCommands")),
    resolvedDecision: v.optional(runtimePermissionDecision),
    resolvedAt: v.optional(v.number()),
    closedAt: v.optional(v.number()),
    closedReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_chat_status", ["userId", "chatId", "status", "createdAt"])
    .index("by_attempt_request", ["attemptId", "permissionRequestId", "createdAt"])
    .index("by_attempt_status", ["attemptId", "status", "createdAt"])
    .index("by_run", ["runId", "createdAt"])
    .index("by_run_status", ["runId", "status", "createdAt"])
    .index("by_response_command", ["responseCommandRecordId"])
    .index("by_status_expiry", ["status", "expiresAt"]),
};
