import { defineTable } from "convex/server";
import { v } from "convex/values";
import { teamSettings, workEvidence, workStatus } from "./collaboration/work_validators";

export const collaborationWorkSchemaTables = {
  collaborationSettings: defineTable({
    userId: v.string(), chatId: v.id("chats"), settings: teamSettings, updatedAt: v.number(),
  }).index("by_chat", ["chatId"]).index("by_user", ["userId"]),
  collaborationWork: defineTable({
    userId: v.string(), chatId: v.id("chats"), objective: v.string(),
    acceptanceCriteria: v.array(v.string()), requirementRevision: v.number(),
    assigneeId: v.optional(v.id("chatParticipants")),
    reviewerIds: v.array(v.id("chatParticipants")),
    readOnlyReview: v.optional(v.boolean()),
    deferred: v.optional(v.boolean()),
    dependencyIds: v.array(v.id("collaborationWork")), status: workStatus,
    revision: v.number(), evidenceRevision: v.number(), evidence: v.array(workEvidence),
    sourceRevision: v.optional(v.string()), blocker: v.optional(v.string()),
    pendingPublication: v.optional(v.object({ description: v.string(), sourceRevision: v.string() })),
    needsRevalidation: v.boolean(),
    claim: v.optional(v.object({
      jobId: v.id("generationJobs"), attemptId: v.id("executionAttempts"),
      fence: v.number(), expiresAt: v.number(), requirementRevision: v.number(),
      role: v.union(v.literal("owner"), v.literal("reviewer")),
    })),
    linkedRunIds: v.array(v.id("executionRuns")),
    createdAt: v.number(), updatedAt: v.number(),
  }).index("by_chat", ["chatId", "createdAt"]).index("by_user", ["userId", "updatedAt"]),
  collaborationRequirements: defineTable({
    userId: v.string(), chatId: v.id("chats"), workId: v.id("collaborationWork"),
    revision: v.number(), objective: v.string(), acceptanceCriteria: v.array(v.string()),
    author: v.string(), createdAt: v.number(),
  }).index("by_work", ["workId", "revision"]).index("by_chat", ["chatId"]).index("by_user", ["userId"]),
  collaborationReviews: defineTable({
    userId: v.string(), chatId: v.id("chats"), workId: v.id("collaborationWork"),
    requirementRevision: v.number(), evidenceRevision: v.number(), sourceRevision: v.string(),
    reviewerId: v.optional(v.id("chatParticipants")), author: v.string(),
    outcome: v.union(v.literal("accept"), v.literal("rework"), v.literal("override")),
    reason: v.string(), createdAt: v.number(),
  }).index("by_work", ["workId", "createdAt"]).index("by_chat", ["chatId"]).index("by_user", ["userId"]),
  collaborationWorkOperations: defineTable({
    userId: v.string(), chatId: v.id("chats"), workId: v.id("collaborationWork"),
    operationKey: v.string(), inputJson: v.string(), createdAt: v.number(),
  }).index("by_key", ["userId", "operationKey"]).index("by_chat", ["chatId"]).index("by_user", ["userId"]),
};
