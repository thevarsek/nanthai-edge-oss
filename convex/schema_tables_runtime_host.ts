import { defineTable } from "convex/server";
import { v } from "convex/values";

const runtimeOperatingSystem = v.union(
  v.literal("macos"),
  v.literal("windows"),
  v.literal("linux"),
);

const runtimeArchitecture = v.union(v.literal("arm64"), v.literal("x64"));

const runtimeAdapterCapabilities = v.object({
  protocolVersion: v.string(),
  adapterId: v.string(),
  adapterVersion: v.string(),
  transport: v.union(
    v.literal("sdk"),
    v.literal("stdio_jsonrpc"),
    v.literal("stdio_jsonl"),
    v.literal("acp"),
  ),
  inputModalities: v.array(v.string()),
  eventTypes: v.array(v.string()),
  operations: v.object({
    listModels: v.boolean(),
    cancel: v.boolean(),
    resume: v.boolean(),
    permissionResponse: v.boolean(),
    inputResponse: v.boolean(),
  }),
  nanthaiCollaborationWork: v.optional(v.boolean()),
  nanthaiSourceCitations: v.optional(v.boolean()),
  adapterNative: v.object({
    tools: v.boolean(),
    plugins: v.boolean(),
    mcpServers: v.boolean(),
    skills: v.boolean(),
    webSearch: v.optional(v.boolean()),
  }),
});

const runtimePresenceAdapter = v.object({
  adapterId: v.string(),
  adapterVersion: v.string(),
  authState: v.union(
    v.literal("ready"),
    v.literal("signed_out"),
    v.literal("unavailable"),
  ),
  capabilities: runtimeAdapterCapabilities,
});

export const runtimeHostSchemaTables = {
  runtimeHelperTasks: defineTable({
    userId: v.string(), chatId: v.id("chats"), sourceMessageId: v.id("messages"), sourceJobId: v.optional(v.id("generationJobs")), personaId: v.optional(v.id("personas")), requestKey: v.optional(v.string()),
    purpose: v.union(v.literal("memory"), v.literal("title"), v.literal("forget"), v.literal("decision"), v.literal("compaction")), input: v.string(),
    messages: v.array(v.object({ role: v.string(), content: v.string() })), content: v.string(),
    status: v.union(v.literal("waiting"), v.literal("ready"), v.literal("failed"), v.literal("completed"), v.literal("cancelled")),
    runId: v.optional(v.id("executionRuns")), attemptId: v.optional(v.id("executionAttempts")), fence: v.optional(v.number()),
    completionEventId: v.optional(v.string()), commandRecordId: v.optional(v.id("runtimeCommands")),
    runtimeUsage: v.optional(v.object({
      actualProvider: v.optional(v.string()), actualModelId: v.optional(v.string()),
      inputTokens: v.optional(v.number()), outputTokens: v.optional(v.number()),
      cachedInputTokens: v.optional(v.number()), reasoningTokens: v.optional(v.number()), totalTokens: v.optional(v.number()),
      costSource: v.union(v.literal("provider_reported"), v.literal("api_equivalent_estimate"), v.literal("unpriced")),
      costAmount: v.optional(v.number()), costCurrency: v.optional(v.string()),
      pricingVersion: v.optional(v.string()), unpricedReason: v.optional(v.string()),
    })),
    createdAt: v.number(), completedAt: v.optional(v.number()),
  }).index("by_user", ["userId"]).index("by_chat", ["chatId"]).index("by_source_purpose", ["sourceMessageId", "purpose"]).index("by_run", ["runId"]).index("by_request", ["userId", "requestKey"]),
  runtimePairingRequests: defineTable({
    userId: v.string(),
    pairingId: v.string(),
    codeHash: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("claimed"),
      v.literal("cancelled"),
      v.literal("expired"),
    ),
    expiresAt: v.number(),
    claimedDeviceId: v.optional(v.id("runtimeDevices")),
    consumedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_pairing_id", ["pairingId"])
    .index("by_code_hash", ["codeHash"])
    .index("by_user", ["userId", "createdAt"])
    .index("by_status_expiry", ["status", "expiresAt"]),

  runtimeDevices: defineTable({
    userId: v.string(),
    deviceId: v.string(),
    displayName: v.string(),
    status: v.union(v.literal("active"), v.literal("revoked")),
    operatingSystem: runtimeOperatingSystem,
    architecture: runtimeArchitecture,
    platformRelease: v.string(),
    hostVersion: v.string(),
    hostPublicKey: v.string(),
    currentCredentialId: v.string(),
    currentPresenceId: v.optional(v.id("runtimeDevicePresences")),
    starterPersonaId: v.optional(v.id("personas")),
    starterPersonaBindings: v.optional(v.array(v.object({ adapterId: v.string(), personaId: v.id("personas") }))),
    lastSeenAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    revokedAt: v.optional(v.number()),
    revocationReason: v.optional(v.string()),
    hiddenAt: v.optional(v.number()),
  })
    .index("by_device_id", ["deviceId"])
    .index("by_user_device", ["userId", "deviceId"])
    .index("by_user_status", ["userId", "status", "updatedAt"]),

  runtimeDeviceCredentials: defineTable({
    userId: v.string(),
    runtimeDeviceId: v.id("runtimeDevices"),
    deviceId: v.string(),
    credentialId: v.string(),
    credentialPrefix: v.string(),
    credentialHash: v.string(),
    status: v.union(v.literal("active"), v.literal("revoked")),
    issuedAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    revocationReason: v.optional(v.string()),
  })
    .index("by_credential_id", ["credentialId"])
    .index("by_device_status", ["runtimeDeviceId", "status"])
    .index("by_user_status", ["userId", "status"]),

  runtimeDevicePresences: defineTable({
    userId: v.string(),
    runtimeDeviceId: v.id("runtimeDevices"),
    deviceId: v.string(),
    credentialId: v.string(),
    presenceSessionId: v.string(),
    owner: v.union(v.literal("foreground_cli"), v.literal("tray")),
    status: v.union(
      v.literal("online"),
      v.literal("offline"),
      v.literal("superseded"),
    ),
    connectedAt: v.number(),
    heartbeatAt: v.number(),
    expiresAt: v.number(),
    hostVersion: v.string(),
    operatingSystem: runtimeOperatingSystem,
    architecture: runtimeArchitecture,
    platformRelease: v.string(),
    adapters: v.array(runtimePresenceAdapter),
    disconnectedAt: v.optional(v.number()),
    disconnectReason: v.optional(v.string()),
    executionStoppedAt: v.optional(v.number()),
  })
    .index("by_device_session", ["runtimeDeviceId", "presenceSessionId"])
    .index("by_device_status", ["runtimeDeviceId", "status"])
    .index("by_user_status", ["userId", "status", "heartbeatAt"])
    .index("by_status_expiry", ["status", "expiresAt"]),

  runtimeModelDiscoveryRequests: defineTable({
    userId: v.string(),
    runtimeDeviceId: v.id("runtimeDevices"),
    deviceId: v.string(),
    presenceId: v.id("runtimeDevicePresences"),
    presenceSessionId: v.string(),
    credentialId: v.string(),
    adapterId: v.string(),
    adapterVersion: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("claimed"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("expired"),
    ),
    claimedBy: v.optional(v.string()),
    claimedAt: v.optional(v.number()),
    resultHash: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    expiresAt: v.number(),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_device_presence_status", [
      "runtimeDeviceId",
      "presenceSessionId",
      "status",
      "createdAt",
    ])
    .index("by_user", ["userId", "createdAt"])
    .index("by_status_expiry", ["status", "expiresAt"]),

  runtimeModelDiscoveryModels: defineTable({
    userId: v.string(),
    requestId: v.id("runtimeModelDiscoveryRequests"),
    ordinal: v.number(),
    provider: v.optional(v.string()),
    modelId: v.string(),
    displayName: v.string(),
    availability: v.union(v.literal("available"), v.literal("unavailable")),
    unavailableReason: v.optional(v.string()),
    inputModalities: v.array(v.string()),
    supportsTools: v.boolean(),
    supportsReasoning: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_request_ordinal", ["requestId", "ordinal"])
    .index("by_user", ["userId", "createdAt"]),

  runtimeConversationBindings: defineTable({
    userId: v.string(),
    chatId: v.id("chats"),
    chatParticipantId: v.id("chatParticipants"),
    personaId: v.id("personas"),
    participantRouteSnapshotId: v.optional(v.id("chatParticipantRuntimeRoutes")),
    chatRuntimeOverrideId: v.optional(v.id("chatRuntimeOverrides")),
    routeSnapshotHash: v.string(),
    deviceId: v.string(),
    adapterId: v.string(),
    nativeSessionId: v.string(),
    threadName: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("released"),
      v.literal("revoked"),
    ),
    canonicalFrontierMessageId: v.optional(v.id("messages")),
    lastOwnedNativeTurnId: v.optional(v.string()),
    contextReceipt: v.optional(v.string()),
    lastSyncAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    releasedAt: v.optional(v.number()),
    releaseReason: v.optional(v.string()),
  })
    .index("by_participant_route_status", [
      "chatParticipantId",
      "routeSnapshotHash",
      "status",
    ])
    .index("by_chat_status", ["chatId", "status", "updatedAt"])
    .index("by_user_status", ["userId", "status", "updatedAt"])
    .index("by_native_session", ["deviceId", "adapterId", "nativeSessionId"]),

  runtimeTurnPackets: defineTable({
    runId: v.id("executionRuns"),
    attemptId: v.id("executionAttempts"),
    fence: v.number(),
    userId: v.string(),
    commandId: v.string(),
    packetHash: v.string(),
    storageId: v.id("_storage"),
    byteLength: v.number(),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_attempt", ["attemptId", "createdAt"])
    .index("by_attempt_command", ["attemptId", "commandId"])
    .index("by_user", ["userId", "createdAt"])
    .index("by_expiry", ["expiresAt"]),

  runtimeAttachmentFetchHandles: defineTable({
    userId: v.string(),
    turnPacketId: v.id("runtimeTurnPackets"),
    sourceMessageId: v.id("messages"),
    handle: v.string(),
    storageId: v.id("_storage"),
    mimeType: v.string(),
    byteLength: v.number(),
    maxChunkBytes: v.number(),
    sha256: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_handle", ["handle"])
    .index("by_packet", ["turnPacketId", "createdAt"])
    .index("by_user", ["userId", "createdAt"])
    .index("by_expiry", ["expiresAt"]),
};
