import assert from "node:assert/strict";
import test from "node:test";

import crons from "../crons";
import schema from "../schema";

test("cron registry keeps the expected schedules and internal targets", () => {
  const entries = (crons as any).crons;

  assert.deepEqual(Object.keys(entries).sort(), [
    "checkSlackMcpDrift",
    "cleanOldJobRuns",
    "cleanOrphanedStreamingMessages",
    "cleanStaleJobs",
    "cleanStaleSandboxSessions",
    "cleanStaleSearchPhases",
    "cleanupAccountDeletionTombstones",
    "cleanupExpiredMcpOAuthTransactions",
    "consolidateMemories",
    "ensureSecretCryptoRotation",
    "reconcileExecutionCancellations",
    "refreshModelCatalog",
    "syncArtificialAnalysis",
    "syncImageModels",
    "syncOpenRouterUseCases",
    "syncVideoModels",
  ]);
  assert.deepEqual(entries.refreshModelCatalog.schedule, {
    type: "interval",
    hours: 4,
  });
  assert.deepEqual(entries.cleanStaleJobs.schedule, {
    type: "interval",
    minutes: 15,
  });
  assert.deepEqual(entries.cleanStaleSandboxSessions.schedule, {
    type: "interval",
    minutes: 30,
  });
  assert.deepEqual(entries.checkSlackMcpDrift.schedule, {
    type: "cron",
    cron: "0 6 * * 1",
  });
});

test("schema exposes the indexes and fields that shared clients depend on", () => {
  const tables = (schema as any).tables;
  const oauthFields = tables.oauthConnections.validator.fields;
  const oauthIndexes = tables.oauthConnections.indexes.map(
    (index: { indexDescriptor: string }) => index.indexDescriptor,
  );
  const messageSearch = tables.messages.searchIndexes[0];
  const embeddingIndex = tables.memoryEmbeddings.vectorIndexes[0];
  const scheduledIndexes = tables.scheduledJobs.indexes.map(
    (index: { indexDescriptor: string }) => index.indexDescriptor,
  );
  const videoJobFields = tables.videoJobs.validator.fields;
  const videoJobIndexes = tables.videoJobs.indexes.map(
    (index: { indexDescriptor: string }) => index.indexDescriptor,
  );
  const videoUploadFields = tables.videoOutputUploads.validator.fields;
  const videoUploadIndexes = tables.videoOutputUploads.indexes.map(
    (index: { indexDescriptor: string }) => index.indexDescriptor,
  );

  assert.ok("workspaceId" in oauthFields);
  assert.ok("workspaceName" in oauthFields);
  assert.deepEqual(oauthIndexes, ["by_user", "by_user_provider", "by_status", "by_secret_key"]);
  assert.deepEqual(messageSearch, {
    indexDescriptor: "search_content",
    searchField: "content",
    filterFields: ["chatId", "userId"],
  });
  assert.deepEqual(embeddingIndex, {
    indexDescriptor: "by_embedding",
    vectorField: "embedding",
    dimensions: 1536,
    filterFields: ["memoryId", "userId"],
  });
  assert.deepEqual(scheduledIndexes, [
    "by_user",
    "by_user_next_run",
    "by_execution_run",
    "by_active_execution",
    "by_status",
  ]);
  assert.equal("outputUploadToken" in videoJobFields, false);
  assert.equal("pollingUrl" in videoJobFields, false);
  assert.equal(videoJobIndexes.includes("by_output_upload_token"), false);
  assert.equal("token" in videoUploadFields, false);
  assert.ok("tokenHash" in videoUploadFields);
  assert.ok("expiresAt" in videoUploadFields);
  assert.equal(videoUploadIndexes.includes("by_token"), false);
});
