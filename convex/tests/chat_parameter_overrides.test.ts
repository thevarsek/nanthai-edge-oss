import assert from "node:assert/strict";
import test from "node:test";

import {
  bulkMoveChatsHandler,
  isPinOnlyUpdate,
  updateChatHandler,
} from "../chat/manage_handlers";

test("isPinOnlyUpdate returns false when a chat parameter override is included", () => {
  assert.equal(
    isPinOnlyUpdate({
      chatId: "chat_1" as any,
      isPinned: true,
      temperatureOverride: 1.1,
    }),
    false,
  );

  assert.equal(
    isPinOnlyUpdate({
      chatId: "chat_1" as any,
      isPinned: true,
      includeReasoningOverride: false,
    }),
    false,
  );
});

test("updateChatHandler persists chat parameter overrides", async () => {
  const patches: Array<Record<string, unknown>> = [];
  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "chat_1") {
          return {
            _id: "chat_1",
            userId: "user_1",
            title: "Chat",
            includeReasoningOverride: undefined,
            reasoningEffortOverride: undefined,
          };
        }
        return null;
      },
      patch: async (_id: string, value: Record<string, unknown>) => {
        patches.push(value);
      },
    },
  } as any;

  await updateChatHandler(ctx, {
    chatId: "chat_1",
    temperatureOverride: 1.3,
    maxTokensOverride: 2048,
    includeReasoningOverride: true,
    reasoningEffortOverride: "high",
  } as any);

  assert.equal(patches.length, 1);
  assert.equal(patches[0].temperatureOverride, 1.3);
  assert.equal(patches[0].maxTokensOverride, 2048);
  assert.equal(patches[0].includeReasoningOverride, true);
  assert.equal(patches[0].reasoningEffortOverride, "high");
});

test("updateChatHandler clears reasoning effort when reasoning is disabled", async () => {
  const patches: Array<Record<string, unknown>> = [];
  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "chat_1") {
          return {
            _id: "chat_1",
            userId: "user_1",
            title: "Chat",
            includeReasoningOverride: true,
            reasoningEffortOverride: "high",
          };
        }
        return null;
      },
      patch: async (_id: string, value: Record<string, unknown>) => {
        patches.push(value);
      },
    },
  } as any;

  await updateChatHandler(ctx, {
    chatId: "chat_1",
    includeReasoningOverride: false,
    reasoningEffortOverride: "high",
  } as any);

  assert.equal(patches.length, 1);
  assert.equal(patches[0].includeReasoningOverride, false);
  assert.equal(patches[0].reasoningEffortOverride, undefined);
});

test("updateChatHandler persists auto audio response override", async () => {
  const patches: Array<Record<string, unknown>> = [];
  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "chat_1") {
          return {
            _id: "chat_1",
            userId: "user_1",
            title: "Chat",
          };
        }
        return null;
      },
      patch: async (_id: string, value: Record<string, unknown>) => {
        patches.push(value);
      },
    },
  } as any;

  await updateChatHandler(ctx, {
    chatId: "chat_1",
    autoAudioResponseOverride: "enabled",
  } as any);

  assert.equal(patches.length, 1);
  assert.equal(patches[0].autoAudioResponseOverride, "enabled");
});

test("updateChatHandler rejects activeBranchLeafId from another chat", async () => {
  const patches: Array<Record<string, unknown>> = [];
  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "chat_1") {
          return {
            _id: "chat_1",
            userId: "user_1",
            title: "Chat",
          };
        }
        if (id === "msg_other_chat") {
          return {
            _id: "msg_other_chat",
            chatId: "chat_2",
          };
        }
        return null;
      },
      patch: async (_id: string, value: Record<string, unknown>) => {
        patches.push(value);
      },
    },
  } as any;

  await assert.rejects(
    updateChatHandler(ctx, {
      chatId: "chat_1",
      activeBranchLeafId: "msg_other_chat",
    } as any),
    /must belong to the chat/i,
  );

  assert.equal(patches.length, 0);
});

test("updateChatHandler rejects missing activeBranchLeafId", async () => {
  const patches: Array<Record<string, unknown>> = [];
  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "chat_1") {
          return {
            _id: "chat_1",
            userId: "user_1",
            title: "Chat",
          };
        }
        return null;
      },
      patch: async (_id: string, value: Record<string, unknown>) => {
        patches.push(value);
      },
    },
  } as any;

  await assert.rejects(
    updateChatHandler(ctx, {
      chatId: "chat_1",
      activeBranchLeafId: "msg_missing",
    } as any),
    /must belong to the chat/i,
  );

  assert.equal(patches.length, 0);
});

test("updateChatHandler rejects folder IDs that are not owned by the user", async () => {
  const patches: Array<Record<string, unknown>> = [];
  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "chat_1") {
          return {
            _id: "chat_1",
            userId: "user_1",
            title: "Chat",
          };
        }
        if (id === "folder_other_user") {
          return {
            _id: "folder_other_user",
            userId: "user_2",
            name: "Other User Folder",
          };
        }
        return null;
      },
      patch: async (_id: string, value: Record<string, unknown>) => {
        patches.push(value);
      },
    },
  } as any;

  await assert.rejects(
    updateChatHandler(ctx, {
      chatId: "chat_1",
      folderId: "folder_other_user",
    } as any),
    /folder not found or unauthorized/i,
  );

  assert.equal(patches.length, 0);
});

test("updateChatHandler syncs canonical document folder metadata on folder moves", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "chat_1") {
          return {
            _id: "chat_1",
            userId: "user_1",
            title: "Chat",
          };
        }
        if (id === "folder_1") {
          return {
            _id: "folder_1",
            userId: "user_1",
            name: "Folder",
          };
        }
        return null;
      },
      query: () => ({
        withIndex: () => ({
          collect: async () => [
            { _id: "doc_1", userId: "user_1", originChatId: "chat_1" },
            { _id: "doc_other_user", userId: "user_2", originChatId: "chat_1" },
          ],
        }),
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
  } as any;

  await updateChatHandler(ctx, {
    chatId: "chat_1",
    folderId: "folder_1",
  } as any);

  assert.deepEqual(patches.map((patch) => patch.id), ["chat_1", "doc_1"]);
  assert.equal(patches[0].value.folderId, "folder_1");
  assert.equal(patches[1].value.folderId, "folder_1");
  assert.equal(typeof patches[1].value.updatedAt, "number");
});

test("bulkMoveChatsHandler rejects folder IDs that are not owned by the user", async () => {
  const patches: Array<Record<string, unknown>> = [];
  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "folder_other_user") {
          return {
            _id: "folder_other_user",
            userId: "user_2",
            name: "Other User Folder",
          };
        }
        if (id === "chat_1") {
          return {
            _id: "chat_1",
            userId: "user_1",
          };
        }
        return null;
      },
      patch: async (_id: string, value: Record<string, unknown>) => {
        patches.push(value);
      },
    },
  } as any;

  await assert.rejects(
    bulkMoveChatsHandler(ctx, {
      chatIds: ["chat_1"],
      folderId: "folder_other_user",
    } as any),
    /folder not found or unauthorized/i,
  );

  assert.equal(patches.length, 0);
});

test("bulkMoveChatsHandler syncs canonical document folder metadata", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "folder_1") {
          return {
            _id: "folder_1",
            userId: "user_1",
            name: "Folder",
          };
        }
        if (id === "chat_1" || id === "chat_2") {
          return {
            _id: id,
            userId: "user_1",
          };
        }
        return null;
      },
      query: () => ({
        withIndex: (_indexName: string, builder: (q: { eq: (field: string, value: string) => unknown }) => unknown) => {
          let queriedChatId = "";
          builder({
            eq: (_field: string, value: string) => {
              queriedChatId = value;
              return {};
            },
          });
          return {
            collect: async () => [
              { _id: `doc_${queriedChatId}`, userId: "user_1", originChatId: queriedChatId },
            ],
          };
        },
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
  } as any;

  await bulkMoveChatsHandler(ctx, {
    chatIds: ["chat_1", "chat_2"],
    folderId: "folder_1",
  } as any);

  assert.deepEqual(
    patches.map((patch) => [patch.id, patch.value.folderId]),
    [
      ["chat_1", "folder_1"],
      ["doc_chat_1", "folder_1"],
      ["chat_2", "folder_1"],
      ["doc_chat_2", "folder_1"],
    ],
  );
});
