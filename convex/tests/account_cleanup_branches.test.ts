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
