import assert from "node:assert/strict";
import test from "node:test";

import { deleteUserTableBatch } from "../account/mutations";

test("deleteUserTableBatch cascades message cleanup through chats and removes storage blobs", async () => {
  const deletedRows: string[] = [];
  const deletedStorage: string[] = [];

  const result = await (deleteUserTableBatch as any)._handler({
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          collect: async () =>
            table === "chats" ? [{ _id: "chat_1" }] : [],
          take: async () =>
            table === "messages"
              ? [
                  {
                    _id: "msg_1",
                    audioStorageId: "audio_1",
                    attachments: [{ storageId: "att_1" }, { storageId: "att_2" }],
                  },
                  {
                    _id: "msg_2",
                    attachments: [{ storageId: "att_3" }],
                  },
                ]
              : [],
        }),
      }),
      delete: async (id: string) => {
        deletedRows.push(id);
      },
    },
    storage: {
      delete: async (id: string) => {
        deletedStorage.push(id);
        if (id === "att_2") throw new Error("already deleted");
      },
    },
  }, {
    userId: "user_1",
    tableName: "messages",
  });

  assert.equal(result.deleted, 2);
  assert.deepEqual(deletedRows, ["msg_1", "msg_2"]);
  assert.deepEqual(deletedStorage, ["audio_1", "att_1", "att_2", "att_3"]);
});

test("deleteUserTableBatch deletes storage-bearing generated and uploaded files", async () => {
  const deletedRows: string[] = [];
  const deletedStorage: string[] = [];

  const db = {
    query: (table: string) => ({
      withIndex: () => ({
        take: async () => [
          { _id: `${table}_1`, storageId: `${table}_storage_1` },
          { _id: `${table}_2`, storageId: `${table}_storage_2` },
        ],
      }),
    }),
    delete: async (id: string) => {
      deletedRows.push(id);
    },
  };

  await (deleteUserTableBatch as any)._handler({
    db,
    storage: {
      delete: async (id: string) => {
        deletedStorage.push(id);
      },
    },
  }, {
    userId: "user_1",
    tableName: "generatedFiles",
  });
  await (deleteUserTableBatch as any)._handler({
    db,
    storage: {
      delete: async (id: string) => {
        deletedStorage.push(id);
      },
    },
  }, {
    userId: "user_1",
    tableName: "fileAttachments",
  });

  assert.deepEqual(deletedRows, [
    "generatedFiles_1",
    "generatedFiles_2",
    "fileAttachments_1",
    "fileAttachments_2",
  ]);
  assert.deepEqual(deletedStorage, [
    "generatedFiles_storage_1",
    "generatedFiles_storage_2",
    "fileAttachments_storage_1",
    "fileAttachments_storage_2",
  ]);
});

test("deleteUserTableBatch cleans inline subagent generated file storage", async () => {
  const deletedRows: string[] = [];
  const deletedStorage: string[] = [];

  const result = await (deleteUserTableBatch as any)._handler({
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          collect: async () =>
            table === "subagentBatches" ? [{ _id: "batch_1" }] : [],
          take: async () =>
            table === "subagentRuns"
              ? [
                  {
                    _id: "run_1",
                    generatedFiles: [{ storageId: "gf_1" }, { storageId: "gf_2" }],
                  },
                ]
              : [],
        }),
      }),
      delete: async (id: string) => {
        deletedRows.push(id);
      },
    },
    storage: {
      delete: async (id: string) => {
        deletedStorage.push(id);
      },
    },
  }, {
    userId: "user_1",
    tableName: "subagentRuns",
  });

  assert.equal(result.deleted, 1);
  assert.deepEqual(deletedRows, ["run_1"]);
  assert.deepEqual(deletedStorage, ["gf_1", "gf_2"]);
});

test("deleteUserTableBatch uses special indexes for node positions and request gates", async () => {
  const deletedRows: string[] = [];

  const db = {
    query: (table: string) => ({
      withIndex: () => ({
        collect: async () =>
          table === "chats" ? [{ _id: "chat_1" }] : [],
        take: async () => {
          if (table === "nodePositions") return [{ _id: "pos_1" }, { _id: "pos_2" }];
          if (table === "integrationRequestGates") return [{ _id: "gate_1" }];
          return [];
        },
      }),
    }),
    delete: async (id: string) => {
      deletedRows.push(id);
    },
  };

  const positions = await (deleteUserTableBatch as any)._handler({ db }, {
    userId: "user_1",
    tableName: "nodePositions",
  });
  const gates = await (deleteUserTableBatch as any)._handler({ db }, {
    userId: "user_1",
    tableName: "integrationRequestGates",
  });

  assert.equal(positions.deleted, 2);
  assert.equal(gates.deleted, 1);
  assert.deepEqual(deletedRows, ["pos_1", "pos_2", "gate_1"]);
});

test("deleteUserTableBatch cleans sandbox artifact blobs before deleting rows", async () => {
  const deletedRows: string[] = [];
  const deletedStorage: string[] = [];

  const result = await (deleteUserTableBatch as any)._handler({
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          collect: async () =>
            table === "sandboxSessions" ? [{ _id: "session_1" }] : [],
          take: async () =>
            table === "sandboxArtifacts"
              ? [{ _id: "artifact_1", storageId: "artifact_storage_1" }]
              : [],
        }),
      }),
      delete: async (id: string) => {
        deletedRows.push(id);
      },
    },
    storage: {
      delete: async (id: string) => {
        deletedStorage.push(id);
      },
    },
  }, {
    userId: "user_1",
    tableName: "sandboxArtifacts",
  });

  assert.equal(result.deleted, 1);
  assert.deepEqual(deletedStorage, ["artifact_storage_1"]);
  assert.deepEqual(deletedRows, ["artifact_1"]);
});

test("deleteUserTableBatch covers remaining cascade and special-index account cleanup paths", async () => {
  const deletedRows: string[] = [];

  const db = {
    query: (table: string) => ({
      withIndex: () => ({
        collect: async () => {
          if (table === "searchSessions") return [{ _id: "search_session_1" }];
          if (table === "memories") return [{ _id: "memory_1" }];
          return [];
        },
        take: async () => {
          if (table === "searchPhases") return [{ _id: "phase_1" }];
          if (table === "memoryEmbeddings") return [{ _id: "embedding_1" }];
          if (table === "sandboxSessions") return [{ _id: "sandbox_session_1" }];
          if (table === "skills") return [{ _id: "skill_1" }];
          if (table === "generationJobs") return [{ _id: "generation_job_1" }];
          if (table === "autonomousSessions") return [{ _id: "autonomous_session_1" }];
          if (table === "usageRecords") return [{ _id: "usage_1" }];
          return [];
        },
      }),
    }),
    delete: async (id: string) => {
      deletedRows.push(id);
    },
  };

  const search = await (deleteUserTableBatch as any)._handler({ db }, {
    userId: "user_1",
    tableName: "searchPhases",
  });
  const embeddings = await (deleteUserTableBatch as any)._handler({ db }, {
    userId: "user_1",
    tableName: "memoryEmbeddings",
  });
  const sandboxSessions = await (deleteUserTableBatch as any)._handler({ db }, {
    userId: "user_1",
    tableName: "sandboxSessions",
  });
  const skills = await (deleteUserTableBatch as any)._handler({ db }, {
    userId: "user_1",
    tableName: "skills",
  });
  const generationJobs = await (deleteUserTableBatch as any)._handler({ db }, {
    userId: "user_1",
    tableName: "generationJobs",
  });
  const autonomousSessions = await (deleteUserTableBatch as any)._handler({ db }, {
    userId: "user_1",
    tableName: "autonomousSessions",
  });
  const generic = await (deleteUserTableBatch as any)._handler({ db }, {
    userId: "user_1",
    tableName: "usageRecords",
  });

  assert.deepEqual([
    search.deleted,
    embeddings.deleted,
    sandboxSessions.deleted,
    skills.deleted,
    generationJobs.deleted,
    autonomousSessions.deleted,
    generic.deleted,
  ], [1, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(deletedRows, [
    "phase_1",
    "embedding_1",
    "sandbox_session_1",
    "skill_1",
    "generation_job_1",
    "autonomous_session_1",
    "usage_1",
  ]);
});

test("deleteUserTableBatch cancels scheduled jobs and continues when cancellation already settled", async () => {
  const cancelled: string[] = [];
  const deletedRows: string[] = [];

  const result = await (deleteUserTableBatch as any)._handler({
    db: {
      query: () => ({
        withIndex: () => ({
          take: async () => [
            { _id: "job_1", scheduledFunctionId: "fn_1" },
            { _id: "job_2", scheduledFunctionId: "fn_2" },
            { _id: "job_3" },
          ],
        }),
      }),
      delete: async (id: string) => {
        deletedRows.push(id);
      },
    },
    scheduler: {
      cancel: async (id: string) => {
        cancelled.push(id);
        if (id === "fn_2") throw new Error("already settled");
      },
    },
  }, {
    userId: "user_1",
    tableName: "scheduledJobs",
  });

  assert.equal(result.deleted, 3);
  assert.deepEqual(cancelled, ["fn_1", "fn_2"]);
  assert.deepEqual(deletedRows, ["job_1", "job_2", "job_3"]);
});

test("deleteUserTableBatch cleans document versions and Drive cached blobs only when unreferenced", async () => {
  const deletedRows: string[] = [];
  const deletedStorage: string[] = [];

  const documentVersions = await (deleteUserTableBatch as any)._handler({
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          take: async () =>
            table === "documentVersions"
              ? [{
                  _id: "version_1",
                  storageId: "doc_storage_1",
                  extractionTextStorageId: "doc_text_1",
                  extractionMarkdownStorageId: "doc_md_1",
                }]
              : [],
          first: async () => null,
        }),
      }),
      delete: async (id: string) => {
        deletedRows.push(id);
      },
    },
    storage: {
      delete: async (id: string) => {
        deletedStorage.push(id);
        if (id === "doc_text_1") throw new Error("already deleted");
      },
    },
  }, {
    userId: "user_1",
    tableName: "documentVersions",
  });

  const generatedMedia = await (deleteUserTableBatch as any)._handler({
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          take: async () =>
            table === "generatedMedia"
              ? [{ _id: "media_1", storageId: "media_storage_1" }]
              : [],
        }),
      }),
      delete: async (id: string) => {
        deletedRows.push(id);
      },
    },
    storage: {
      delete: async (id: string) => {
        deletedStorage.push(id);
      },
    },
  }, {
    userId: "user_1",
    tableName: "generatedMedia",
  });

  let attachmentLookupCount = 0;
  const driveGrant = await (deleteUserTableBatch as any)._handler({
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          take: async () =>
            table === "googleDriveFileGrants"
              ? [
                  { _id: "grant_1", cachedStorageId: "cached_1" },
                  { _id: "grant_2", cachedStorageId: "cached_2" },
                  { _id: "grant_3" },
                ]
              : [],
          first: async () => {
            if (table !== "fileAttachments") return null;
            attachmentLookupCount += 1;
            return attachmentLookupCount === 1 ? { _id: "attachment_existing" } : null;
          },
        }),
      }),
      delete: async (id: string) => {
        deletedRows.push(id);
      },
    },
    storage: {
      delete: async (id: string) => {
        deletedStorage.push(id);
      },
    },
  }, {
    userId: "user_1",
    tableName: "googleDriveFileGrants",
  });

  assert.deepEqual([documentVersions.deleted, generatedMedia.deleted, driveGrant.deleted], [1, 1, 3]);
  assert.deepEqual(deletedRows, ["version_1", "media_1", "grant_1", "grant_2", "grant_3"]);
  assert.deepEqual(deletedStorage, [
    "doc_storage_1",
    "doc_text_1",
    "doc_md_1",
    "media_storage_1",
    "cached_2",
  ]);
});
