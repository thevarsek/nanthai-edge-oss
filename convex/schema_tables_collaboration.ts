import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
  collaborationBounds,
  collaborationDecisionStatus,
  collaborationExchangeStatus,
  collaborationGenerationSnapshot,
  collaborationParticipantSnapshot,
  collaborationSelection,
} from "./collaboration/validators";

export const collaborationSchemaTables = {
  collaborationExchanges: defineTable({
    userId: v.string(),
    chatId: v.id("chats"),
    initiatingMessageId: v.id("messages"),
    participantSnapshot: v.array(collaborationParticipantSnapshot),
    mentionedParticipantIds: v.array(v.id("chatParticipants")),
    pendingMentionedParticipantIds: v.array(v.id("chatParticipants")),
    generationSnapshot: collaborationGenerationSnapshot,
    policyVersion: v.string(),
    schedulerVersion: v.string(),
    status: collaborationExchangeStatus,
    currentWave: v.number(),
    publishedMessageCount: v.number(),
    frontierMessageIds: v.array(v.id("messages")),
    pendingHumanMessageIds: v.array(v.id("messages")),
    activeParticipantIds: v.array(v.id("chatParticipants")),
    failedParticipantIds: v.array(v.id("chatParticipants")),
    bounds: collaborationBounds,
    terminalReason: v.optional(v.string()),
    error: v.optional(v.string()),
    workflowId: v.optional(v.string()),
    executionRunId: v.optional(v.id("executionRuns")),
    executionAttemptId: v.optional(v.id("executionAttempts")),
    executionFence: v.optional(v.number()),
    executionClaimantId: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_chat", ["chatId", "createdAt"])
    .index("by_chat_status", ["chatId", "status", "updatedAt"])
    .index("by_user", ["userId", "updatedAt"])
    .index("by_initiating_message", ["initiatingMessageId"])
    .index("by_execution_run", ["executionRunId"]),

  collaborationDecisions: defineTable({
    userId: v.string(),
    chatId: v.id("chats"),
    exchangeId: v.id("collaborationExchanges"),
    wave: v.number(),
    decisionKey: v.string(),
    frontierMessageIds: v.array(v.id("messages")),
    selections: v.array(collaborationSelection),
    excludedParticipantIds: v.array(v.id("chatParticipants")),
    status: collaborationDecisionStatus,
    schedulerVersion: v.string(),
    schedulerModelId: v.optional(v.string()),
    diagnosticCategory: v.string(),
    assistantMessageIds: v.optional(v.array(v.id("messages"))),
    generationJobIds: v.optional(v.array(v.id("generationJobs"))),
    successfulMessageIds: v.optional(v.array(v.id("messages"))),
    failedParticipantIds: v.optional(v.array(v.id("chatParticipants"))),
    usageRecordId: v.optional(v.id("usageRecords")),
    createdAt: v.number(),
    updatedAt: v.number(),
    settledAt: v.optional(v.number()),
  })
    .index("by_exchange_wave", ["exchangeId", "wave"])
    .index("by_decision_key", ["decisionKey"])
    .index("by_chat", ["chatId", "createdAt"])
    .index("by_user", ["userId", "createdAt"]),
};
