import assert from "node:assert/strict";
import test from "node:test";

import { deleteUserTableBatch } from "../account/mutations";

const BATCH_SIZE = 200;

type CascadeCase = {
  tableName: string;
  parentTable: string;
  childTable: string;
  parentKey: string;
  childPrefix: string;
};

const cascadeCases: CascadeCase[] = [
  {
    tableName: "searchPhases",
    parentTable: "searchSessions",
    childTable: "searchPhases",
    parentKey: "session",
    childPrefix: "phase",
  },
  {
    tableName: "memoryEmbeddings",
    parentTable: "memories",
    childTable: "memoryEmbeddings",
    parentKey: "memory",
    childPrefix: "embedding",
  },
  {
    tableName: "messages",
    parentTable: "chats",
    childTable: "messages",
    parentKey: "chat",
    childPrefix: "message",
  },
  {
    tableName: "nodePositions",
    parentTable: "chats",
    childTable: "nodePositions",
    parentKey: "chat",
    childPrefix: "position",
  },
  {
    tableName: "subagentRuns",
    parentTable: "subagentBatches",
    childTable: "subagentRuns",
    parentKey: "batch",
    childPrefix: "run",
  },
  {
    tableName: "sandboxArtifacts",
    parentTable: "sandboxSessions",
    childTable: "sandboxArtifacts",
    parentKey: "sandbox_session",
    childPrefix: "artifact",
  },
];

test("deleteUserTableBatch stops cascaded cleanup at the batch boundary", async () => {
  for (const testCase of cascadeCases) {
    const queriedChildrenForParents: string[] = [];
    const deletedRows: string[] = [];

    const result = await (deleteUserTableBatch as any)._handler({
      db: {
        query: (table: string) => ({
          withIndex: () => ({
            paginate: async () => ({
              page: table === testCase.parentTable
                ? [{ _id: `${testCase.parentKey}_1` }, { _id: `${testCase.parentKey}_2` }]
                : [],
              continueCursor: "next",
              isDone: true,
            }),
            take: async (limit: number) => {
              if (table !== testCase.childTable) return [];
              queriedChildrenForParents.push(`${testCase.parentKey}_${queriedChildrenForParents.length + 1}`);
              return Array.from({ length: limit }, (_, index) => ({
                _id: `${testCase.childPrefix}_${index + 1}`,
              }));
            },
          }),
        }),
        delete: async (id: string) => {
          deletedRows.push(id);
        },
      },
      storage: {
        delete: async () => {},
      },
    }, {
      userId: "user_1",
      tableName: testCase.tableName,
    });

    assert.equal(result.deleted, BATCH_SIZE, testCase.tableName);
    assert.equal(deletedRows.length, BATCH_SIZE, testCase.tableName);
    assert.deepEqual(
      queriedChildrenForParents,
      [`${testCase.parentKey}_1`],
      `${testCase.tableName} should leave later parents for the next batch`,
    );
  }
});

test("deleteUserTableBatch tolerates missing blobs while deleting account-owned rows", async () => {
  const deletedRows: string[] = [];
  const deletedStorage: string[] = [];

  const db = {
    query: (table: string) => ({
      withIndex: () => ({
        paginate: async () => ({
          page: table === "chats"
            ? [{ _id: "chat_1" }]
            : table === "subagentBatches"
              ? [{ _id: "batch_1" }]
              : table === "sandboxSessions"
                ? [{ _id: "sandbox_session_1" }]
                : [],
          continueCursor: "done",
          isDone: true,
        }),
        take: async () => {
          if (table === "messages") {
            if (deletedRows.includes("message_1")) return [];
            return [{ _id: "message_1", audioStorageId: "audio_missing" }];
          }
          if (table === "subagentRuns") {
            return [{ _id: "run_1", generatedFiles: [{ storageId: "run_file_missing" }] }];
          }
          if (table === "sandboxArtifacts") {
            return [{ _id: "artifact_1", storageId: "artifact_missing" }];
          }
          if (table === "documentVersions") {
            return [{
              _id: "version_1",
              storageId: "version_missing",
              extractionMarkdownStorageId: "markdown_missing",
            }];
          }
          if (table === "generatedFiles") {
            return [{ _id: "generated_file_1", storageId: "generated_file_missing" }];
          }
          if (table === "generatedMedia") {
            return [{ _id: "media_1", storageId: "media_missing" }];
          }
          if (table === "googleDriveFileGrants") {
            return [{ _id: "grant_1", cachedStorageId: "drive_missing" }];
          }
          return [];
        },
        first: async () => null,
      }),
    }),
    delete: async (id: string) => {
      deletedRows.push(id);
    },
  };
  const storage = {
    delete: async (id: string) => {
      deletedStorage.push(id);
      throw new Error("already deleted");
    },
  };

  for (const tableName of [
    "messages",
    "subagentRuns",
    "sandboxArtifacts",
    "documentVersions",
    "generatedFiles",
    "generatedMedia",
    "googleDriveFileGrants",
  ]) {
    await (deleteUserTableBatch as any)._handler({ db, storage }, {
      userId: "user_1",
      tableName,
    });
  }

  assert.deepEqual(deletedRows, [
    "message_1",
    "run_1",
    "artifact_1",
    "version_1",
    "generated_file_1",
    "media_1",
    "grant_1",
  ]);
  assert.deepEqual(deletedStorage, [
    "audio_missing",
    "run_file_missing",
    "artifact_missing",
    "markdown_missing",
    "version_missing",
    "generated_file_missing",
    "drive_missing",
  ]);
});
