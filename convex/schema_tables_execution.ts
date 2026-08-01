import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
  authorizationSource,
  executionAttemptState,
  executionOperationStatus,
  executionPlacement,
  executionRunKind,
  executionRunState,
  executionTerminalOutcome,
  executorKind,
  runEventType,
  runtimeCommandStatus,
  runtimeCommandType,
  toolEffect,
  toolRetryPolicy,
} from "./execution/validators";

export const executionSchemaTables = {
  executionRuns: defineTable({
    userId: v.string(),
    runKey: v.optional(v.string()),
    chatId: v.optional(v.id("chats")),
    sourceMessageId: v.optional(v.id("messages")),
    generationJobId: v.optional(v.id("generationJobs")),
    domainType: v.optional(v.string()),
    domainId: v.optional(v.string()),
    parentRunId: v.optional(v.id("executionRuns")),
    rootRunId: v.optional(v.id("executionRuns")),
    kind: executionRunKind,
    state: executionRunState,
    requestedPlacement: executionPlacement,
    activeAttemptId: v.optional(v.id("executionAttempts")),
    nextAttemptNumber: v.number(),
    nextFence: v.optional(v.number()),
    nextEventSequence: v.number(),
    cancelRequestedAt: v.optional(v.number()),
    cancelRequestedBy: v.optional(v.string()),
    terminalOutcome: v.optional(executionTerminalOutcome),
    terminalSummary: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId", "updatedAt"])
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_user_chat", ["userId", "chatId", "updatedAt"])
    .index("by_chat", ["chatId", "updatedAt"])
    .index("by_chat_created", ["chatId", "createdAt"])
    .index("by_chat_state", ["chatId", "state", "updatedAt"])
    .index("by_parent", ["parentRunId", "createdAt"])
    .index("by_user_run_key", ["userId", "runKey"])
    .index("by_user_domain", ["userId", "domainType", "domainId"])
    .index("by_generation_job", ["generationJobId"])
    .index("by_state", ["state", "updatedAt"]),

  executionAttempts: defineTable({
    runId: v.id("executionRuns"),
    userId: v.string(),
    attemptNumber: v.number(),
    executorKind,
    placement: executionPlacement,
    adapterId: v.string(),
    adapterVersion: v.optional(v.string()),
    provider: v.optional(v.string()),
    modelId: v.optional(v.string()),
    runtimeLabel: v.optional(v.string()),
    deviceId: v.optional(v.string()),
    workspaceId: v.optional(v.string()),
    protocolVersion: v.string(),
    orchestrationEngine: v.optional(v.union(
      v.literal("legacy_scheduler"),
      v.literal("convex_workflow"),
      v.literal("convex_workpool"),
      v.literal("runtime_adapter"),
    )),
    orchestrationVersion: v.optional(v.string()),
    rolloutCohort: v.optional(v.string()),
    status: executionAttemptState,
    claimantId: v.optional(v.string()),
    fence: v.number(),
    leaseExpiresAt: v.optional(v.number()),
    heartbeatAt: v.optional(v.number()),
    checkpointRef: v.optional(v.string()),
    componentOperationId: v.optional(v.string()),
    supersededByAttemptId: v.optional(v.id("executionAttempts")),
    errorSummary: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_run", ["runId", "attemptNumber"])
    .index("by_run_status", ["runId", "status", "updatedAt"])
    .index("by_user", ["userId", "createdAt"])
    .index("by_user_status", ["userId", "status", "updatedAt"])
    .index("by_engine_status", ["orchestrationEngine", "status", "updatedAt"])
    .index("by_lease", ["status", "leaseExpiresAt"]),

  runtimeCommands: defineTable({
    runId: v.id("executionRuns"),
    attemptId: v.id("executionAttempts"),
    userId: v.string(),
    commandId: v.string(),
    expectedFence: v.number(),
    type: runtimeCommandType,
    status: runtimeCommandStatus,
    authorizationSource,
    initiatedBy: v.string(),
    inputHash: v.string(),
    payload: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    acknowledgedAt: v.optional(v.number()),
    claimedAt: v.optional(v.number()),
    claimedBy: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    rejectionReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_run_command", ["runId", "commandId"])
    .index("by_run_status", ["runId", "status", "updatedAt"])
    .index("by_attempt_status", ["attemptId", "status", "createdAt"])
    .index("by_user", ["userId", "createdAt"]),

  runEvents: defineTable({
    runId: v.id("executionRuns"),
    attemptId: v.id("executionAttempts"),
    userId: v.string(),
    eventId: v.string(),
    fence: v.number(),
    sequence: v.number(),
    type: runEventType,
    summary: v.string(),
    phase: v.optional(v.string()),
    progress: v.optional(v.number()),
    artifactIds: v.optional(v.array(v.string())),
    privacyClass: v.optional(v.string()),
    adapterDetail: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_run_sequence", ["runId", "sequence"])
    .index("by_attempt_event", ["attemptId", "eventId"])
    .index("by_user", ["userId", "createdAt"]),

  runtimeSessionBindings: defineTable({
    runId: v.id("executionRuns"),
    attemptId: v.id("executionAttempts"),
    userId: v.string(),
    adapterId: v.string(),
    bindingKey: v.string(),
    fence: v.number(),
    status: v.union(
      v.literal("active"),
      v.literal("released"),
      v.literal("revoked"),
    ),
    nativeSessionId: v.string(),
    deviceId: v.optional(v.string()),
    workspaceId: v.optional(v.string()),
    boundAt: v.number(),
    releasedAt: v.optional(v.number()),
    releaseReason: v.optional(v.string()),
  })
    .index("by_attempt", ["attemptId"])
    .index("by_attempt_status", ["attemptId", "status"])
    .index("by_attempt_key", ["attemptId", "bindingKey"])
    .index("by_run_status", ["runId", "status"])
    .index("by_user", ["userId", "boundAt"])
    .index("by_user_adapter_session", ["userId", "adapterId", "nativeSessionId"]),

  executionComponentRefs: defineTable({
    runId: v.id("executionRuns"),
    attemptId: v.optional(v.id("executionAttempts")),
    userId: v.string(),
    adapterId: v.union(
      v.literal("convex-workflow"),
      v.literal("interactive-workpool"),
      v.literal("background-workpool"),
      v.literal("maintenance-workpool"),
      v.literal("external-cloud"),
      v.literal("local-runtime"),
    ),
    operationId: v.string(),
    role: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("completed"),
      v.literal("cancel_requested"),
      v.literal("cancelled"),
      v.literal("failed"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    terminalAt: v.optional(v.number()),
    cancelSafeAfter: v.optional(v.number()),
    cancelAcknowledgedAt: v.optional(v.number()),
  })
    .index("by_run", ["runId", "createdAt"])
    .index("by_run_role", ["runId", "role"])
    .index("by_attempt", ["attemptId", "createdAt"])
    .index("by_operation", ["adapterId", "operationId"])
    .index("by_run_status", ["runId", "status"])
    .index("by_status_updated", ["status", "updatedAt"])
    .index("by_user", ["userId", "createdAt"])
    .index("by_user_status", ["userId", "status", "updatedAt"]),

  executionOperations: defineTable({
    runId: v.id("executionRuns"),
    attemptId: v.id("executionAttempts"),
    userId: v.string(),
    operationKey: v.string(),
    toolName: v.string(),
    toolCallId: v.string(),
    effect: toolEffect,
    retry: toolRetryPolicy,
    authorizationSource,
    status: executionOperationStatus,
    inputHash: v.string(),
    externalId: v.optional(v.string()),
    resultJson: v.optional(v.string()),
    errorSummary: v.optional(v.string()),
    dispatchedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_run_operation", ["runId", "operationKey"])
    .index("by_run_status", ["runId", "status", "updatedAt"])
    .index("by_attempt_status", ["attemptId", "status", "updatedAt"])
    .index("by_user", ["userId", "updatedAt"]),

  executionTeardownTasks: defineTable({
    rootRunId: v.id("executionRuns"),
    runId: v.id("executionRuns"),
    userId: v.string(),
    chatId: v.optional(v.id("chats")),
    requestedBy: v.string(),
    reason: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("expanding"),
      v.literal("waiting_for_children"),
      v.literal("cancelling"),
      v.literal("settled"),
    ),
    childCursor: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_root_run", ["rootRunId", "runId"])
    .index("by_root_status", ["rootRunId", "status", "updatedAt"])
    .index("by_user", ["userId", "updatedAt"])
    .index("by_user_status", ["userId", "status", "updatedAt"])
    .index("by_chat", ["chatId", "updatedAt"])
    .index("by_chat_status", ["chatId", "status", "updatedAt"]),

  secretCryptoRotations: defineTable({
    sourceKeyIds: v.array(v.string()),
    targetKeyId: v.string(),
    status: v.union(
      v.literal("dry_run"),
      v.literal("running"),
      v.literal("verifying"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    table: v.union(
      v.literal("oauthConnections"),
      v.literal("userSecrets"),
      v.literal("mcpCredentials"),
    ),
    cursor: v.optional(v.string()),
    scannedCount: v.number(),
    migratedCount: v.number(),
    conflictCount: v.number(),
    failureCount: v.number(),
    lastSafeErrorCode: v.optional(v.string()),
    startedAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
    executionRunId: v.optional(v.id("executionRuns")),
    executionAttemptId: v.optional(v.id("executionAttempts")),
  })
    .index("by_status", ["status", "updatedAt"])
    .index("by_target", ["targetKeyId", "updatedAt"])
    .index("by_run", ["executionRunId"]),
};
