import assert from "node:assert/strict";
import test from "node:test";

import crons from "../crons";
import schema from "../schema";

test("cron registry keeps the expected schedules and internal targets", () => {
  const entries = (crons as any).crons;

  assert.deepEqual(Object.keys(entries).sort(), [
    "cleanOldJobRuns",
    "cleanStaleJobs",
    "cleanStaleSandboxSessions",
    "cleanStaleSearchPhases",
    "consolidateMemories",
    "refreshModelCatalog",
    "syncArtificialAnalysis",
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

  assert.ok("workspaceId" in oauthFields);
  assert.ok("workspaceName" in oauthFields);
  assert.deepEqual(oauthIndexes, ["by_user", "by_user_provider", "by_status"]);
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
    "by_status",
  ]);
});
