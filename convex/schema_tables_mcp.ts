import { defineTable } from "convex/server";
import { v } from "convex/values";

const connectionStatus = v.union(
  v.literal("validating"),
  v.literal("auth_required"),
  v.literal("authorizing"),
  v.literal("reviewing"),
  v.literal("active"),
  v.literal("disabled"),
  v.literal("unsupported"),
  v.literal("error"),
  v.literal("disconnecting"),
);

const authMode = v.union(
  v.literal("none"),
  v.literal("bearer"),
  v.literal("api_key"),
  v.literal("oauth"),
);

const catalogKind = v.union(
  v.literal("tool"),
  v.literal("prompt"),
  v.literal("resource"),
  v.literal("resource_template"),
);

const invocationContentItem = v.object({
  kind: v.union(
    v.literal("text"),
    v.literal("image"),
    v.literal("audio"),
    v.literal("blob"),
    v.literal("resource_link"),
  ),
  role: v.optional(v.string()),
  text: v.optional(v.string()),
  storageId: v.optional(v.id("_storage")),
  mimeType: v.optional(v.string()),
  name: v.optional(v.string()),
  uri: v.optional(v.string()),
  sizeBytes: v.optional(v.number()),
});

export const mcpSchemaTables = {
  mcpConnections: defineTable({
    userId: v.string(),
    publicId: v.string(),
    integrationId: v.string(),
    endpoint: v.string(),
    endpointOrigin: v.string(),
    endpointHost: v.string(),
    friendlyName: v.optional(v.string()),
    status: connectionStatus,
    authMode,
    protocolVersion: v.optional(v.literal("2026-07-28")),
    supportedVersions: v.optional(v.array(v.string())),
    serverName: v.optional(v.string()),
    serverVersion: v.optional(v.string()),
    capabilities: v.optional(v.any()),
    extensions: v.optional(v.any()),
    instructions: v.optional(v.string()),
    catalogExpiresAt: v.optional(v.number()),
    lastCheckedAt: v.optional(v.number()),
    lastSuccessAt: v.optional(v.number()),
    lastErrorCode: v.optional(v.string()),
    oauthTransactionStateHash: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId", "updatedAt"])
    .index("by_user_public_id", ["userId", "publicId"])
    .index("by_user_status", ["userId", "status", "updatedAt"]),

  mcpCredentials: defineTable({
    userId: v.string(),
    connectionId: v.id("mcpConnections"),
    authMode,
    issuerOrOrigin: v.string(),
    resourceOrigin: v.string(),
    apiKeyHeader: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    refreshToken: v.optional(v.string()),
    credentialValue: v.optional(v.string()),
    clientId: v.optional(v.string()),
    clientSecret: v.optional(v.string()),
    tokenEndpoint: v.optional(v.string()),
    revocationEndpoint: v.optional(v.string()),
    scopes: v.optional(v.array(v.string())),
    expiresAt: v.optional(v.number()),
    refreshRevision: v.number(),
    refreshLeaseId: v.optional(v.string()),
    refreshLeaseExpiresAt: v.optional(v.number()),
    secretEnvelopeVersion: v.literal(2),
    secretKeyId: v.string(),
    secretMigratedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_connection", ["connectionId"])
    .index("by_user", ["userId", "updatedAt"])
    .index("by_secret_key", ["secretKeyId"]),

  mcpOAuthTransactions: defineTable({
    userId: v.string(),
    connectionId: v.id("mcpConnections"),
    stateHash: v.string(),
    issuerOrOrigin: v.string(),
    resourceOrigin: v.string(),
    authorizationEndpoint: v.string(),
    tokenEndpoint: v.string(),
    revocationEndpoint: v.optional(v.string()),
    redirectUri: v.string(),
    scopes: v.array(v.string()),
    clientId: v.string(),
    clientSecret: v.optional(v.string()),
    encryptedPkceVerifier: v.string(),
    secretEnvelopeVersion: v.literal(2),
    secretKeyId: v.string(),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_state_hash", ["stateHash"])
    .index("by_connection", ["connectionId", "createdAt"])
    .index("by_user", ["userId", "createdAt"])
    .index("by_expiry", ["expiresAt"]),

  mcpCatalogSnapshots: defineTable({
    userId: v.string(),
    connectionId: v.id("mcpConnections"),
    revision: v.number(),
    itemCount: v.number(),
    contentHash: v.string(),
    cacheScope: v.optional(v.union(v.literal("public"), v.literal("private"))),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_connection", ["connectionId", "revision"])
    .index("by_user", ["userId", "createdAt"]),

  mcpCatalogItems: defineTable({
    userId: v.string(),
    connectionId: v.id("mcpConnections"),
    snapshotId: v.id("mcpCatalogSnapshots"),
    kind: catalogKind,
    remoteName: v.string(),
    stableKey: v.string(),
    toolAlias: v.optional(v.string()),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    uri: v.optional(v.string()),
    uriTemplate: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    inputSchema: v.optional(v.any()),
    outputSchema: v.optional(v.any()),
    arguments: v.optional(v.any()),
    annotations: v.optional(v.any()),
    metadata: v.optional(v.any()),
    decision: v.union(v.literal("allowed"), v.literal("disabled")),
    definitionHash: v.string(),
    disabledReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_connection", ["connectionId", "kind", "remoteName"])
    .index("by_connection_decision", ["connectionId", "decision", "kind"])
    .index("by_user", ["userId", "updatedAt"])
    .index("by_stable_key", ["connectionId", "stableKey"]),

  mcpInvocations: defineTable({
    userId: v.string(),
    publicId: v.string(),
    connectionId: v.id("mcpConnections"),
    catalogItemId: v.optional(v.id("mcpCatalogItems")),
    catalogStableKey: v.optional(v.string()),
    itemName: v.optional(v.string()),
    toolAlias: v.optional(v.string()),
    kind: catalogKind,
    method: v.string(),
    state: v.union(
      v.literal("dispatching"),
      v.literal("awaiting_input"),
      v.literal("task_pending"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
      v.literal("outcome_unknown"),
    ),
    chatId: v.optional(v.id("chats")),
    messageId: v.optional(v.id("messages")),
    generationJobId: v.optional(v.id("generationJobs")),
    runId: v.optional(v.id("executionRuns")),
    attemptId: v.optional(v.id("executionAttempts")),
    fence: v.optional(v.number()),
    durableRunId: v.optional(v.id("executionRuns")),
    durableAttemptId: v.optional(v.id("executionAttempts")),
    durableFence: v.optional(v.number()),
    operationKey: v.optional(v.string()),
    activeOperationKey: v.optional(v.string()),
    toolCallId: v.optional(v.string()),
    parentResumeEventId: v.optional(v.string()),
    workflowId: v.optional(v.string()),
    taskResumeEventId: v.optional(v.string()),
    executionClaimantId: v.optional(v.string()),
    requestHash: v.string(),
    requestParams: v.optional(v.any()),
    requestState: v.optional(v.any()),
    inputRequests: v.optional(v.any()),
    taskId: v.optional(v.string()),
    taskStatus: v.optional(v.string()),
    nextPollAt: v.optional(v.number()),
    result: v.optional(v.any()),
    contextText: v.optional(v.string()),
    contentItems: v.optional(v.array(invocationContentItem)),
    artifactIds: v.optional(v.array(v.string())),
    errorCode: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId", "updatedAt"])
    .index("by_user_public_id", ["userId", "publicId"])
    .index("by_connection", ["connectionId", "updatedAt"])
    .index("by_connection_state", ["connectionId", "state", "updatedAt"])
    .index("by_chat_state", ["chatId", "state", "updatedAt"])
    .index("by_state", ["state", "nextPollAt"])
    .index("by_chat", ["chatId", "updatedAt"])
    .index("by_run", ["runId", "updatedAt"]),
};
