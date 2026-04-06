import assert from "node:assert/strict";
import test from "node:test";

import {
  areSiblingMessages,
  buildCopiedMessageInsert,
  deriveCopiedChatMetadata,
  normalizeCopiedStatus,
  resolveSwitchedBranchLeaf,
} from "../chat/manage_helpers";
import { loadAllChatMessages, loadMessagesForFork } from "../chat/manage_copy_helpers";

test("normalizeCopiedStatus converts in-flight states to completed", () => {
  assert.equal(normalizeCopiedStatus("pending"), "completed");
  assert.equal(normalizeCopiedStatus("streaming"), "completed");
  assert.equal(normalizeCopiedStatus("failed"), "failed");
});

test("buildCopiedMessageInsert preserves participant and reasoning metadata", () => {
  const sourceMessage: any = {
    _id: "msg_source",
    _creationTime: 1,
    chatId: "chat_source",
    role: "assistant",
    content: "hello world",
    modelId: "openai/gpt-5.2",
    participantId: "persona_1",
    participantName: "Strategist",
    participantEmoji: "🧠",
    parentMessageIds: ["parent_0"],
    multiModelGroupId: "group_1",
    isMultiModelResponse: true,
    status: "pending",
    reasoning: "internal chain",
    usage: {
      promptTokens: 10,
      completionTokens: 12,
      totalTokens: 22,
    },
    imageUrls: ["https://example.com/image.png"],
    attachments: [
      {
        type: "image",
        url: "https://example.com/image.png",
      },
    ],
    createdAt: 1700000000000,
  };

  const copied = buildCopiedMessageInsert(
    sourceMessage,
    "chat_new" as any,
    ["parent_new"] as any,
  );

  assert.equal(copied.chatId, "chat_new");
  assert.equal(copied.participantEmoji, "🧠");
  assert.equal(copied.reasoning, "internal chain");
  assert.equal(copied.multiModelGroupId, "group_1");
  assert.equal(copied.isMultiModelResponse, true);
  assert.equal(copied.status, "completed");
  assert.deepEqual(copied.parentMessageIds, ["parent_new"]);
});

test("deriveCopiedChatMetadata respects preferred leaf and latest preview", () => {
  const metadata = deriveCopiedChatMetadata(
    [
      {
        messageId: "m1" as any,
        createdAt: 100,
        content: "first",
      },
      {
        messageId: "m2" as any,
        createdAt: 200,
        content: "",
      },
      {
        messageId: "m3" as any,
        createdAt: 300,
        content: "x".repeat(300),
      },
    ],
    "m2" as any,
  );

  assert.equal(metadata.messageCount, 3);
  assert.equal(metadata.activeBranchLeafId, "m2");
  assert.equal(metadata.lastMessageDate, 300);
  assert.equal(metadata.lastMessagePreview?.length, 200);
});

function message(args: {
  id: string;
  createdAt: number;
  parentMessageIds?: string[];
  multiModelGroupId?: string;
}) {
  return {
    _id: args.id,
    createdAt: args.createdAt,
    parentMessageIds: args.parentMessageIds ?? [],
    multiModelGroupId: args.multiModelGroupId,
  } as any;
}

test("areSiblingMessages returns true for overlapping direct parents", () => {
  const current = message({ id: "a1", createdAt: 1, parentMessageIds: ["root"] });
  const target = message({ id: "b1", createdAt: 2, parentMessageIds: ["root"] });

  assert.equal(areSiblingMessages(current, target), true);
});

test("resolveSwitchedBranchLeaf preserves nested fork choice on matching target subtree", () => {
  const messages = [
    message({ id: "root", createdAt: 1 }),
    message({ id: "a1", createdAt: 2, parentMessageIds: ["root"] }),
    message({ id: "b1", createdAt: 3, parentMessageIds: ["root"] }),
    message({ id: "a2", createdAt: 4, parentMessageIds: ["a1"] }),
    message({ id: "b2", createdAt: 5, parentMessageIds: ["b1"] }),
    message({ id: "a3a", createdAt: 6, parentMessageIds: ["a2"] }),
    message({ id: "a3b", createdAt: 7, parentMessageIds: ["a2"] }),
    message({ id: "b3a", createdAt: 8, parentMessageIds: ["b2"] }),
    message({ id: "b3b", createdAt: 9, parentMessageIds: ["b2"] }),
  ];

  const nextLeaf = resolveSwitchedBranchLeaf({
    messages,
    activeBranchLeafId: "a3b",
    currentSiblingMessageId: "a1",
    targetSiblingMessageId: "b1",
  });

  assert.equal(nextLeaf, "b3b");
});

test("resolveSwitchedBranchLeaf only changes the selected nested fork", () => {
  const messages = [
    message({ id: "root", createdAt: 1 }),
    message({ id: "a1", createdAt: 2, parentMessageIds: ["root"] }),
    message({ id: "b1", createdAt: 3, parentMessageIds: ["root"] }),
    message({ id: "a2", createdAt: 4, parentMessageIds: ["a1"] }),
    message({ id: "a3a", createdAt: 5, parentMessageIds: ["a2"] }),
    message({ id: "a3b", createdAt: 6, parentMessageIds: ["a2"] }),
  ];

  const nextLeaf = resolveSwitchedBranchLeaf({
    messages,
    activeBranchLeafId: "a3b",
    currentSiblingMessageId: "a3b",
    targetSiblingMessageId: "a3a",
  });

  assert.equal(nextLeaf, "a3a");
});

test("resolveSwitchedBranchLeaf falls back to earliest available continuation", () => {
  const messages = [
    message({ id: "root", createdAt: 1 }),
    message({ id: "a1", createdAt: 2, parentMessageIds: ["root"] }),
    message({ id: "b1", createdAt: 3, parentMessageIds: ["root"] }),
    message({ id: "a2", createdAt: 4, parentMessageIds: ["a1"] }),
    message({ id: "a3a", createdAt: 5, parentMessageIds: ["a2"] }),
    message({ id: "a3b", createdAt: 6, parentMessageIds: ["a2"] }),
    message({ id: "b2", createdAt: 7, parentMessageIds: ["b1"] }),
  ];

  const nextLeaf = resolveSwitchedBranchLeaf({
    messages,
    activeBranchLeafId: "a3b",
    currentSiblingMessageId: "a1",
    targetSiblingMessageId: "b1",
  });

  assert.equal(nextLeaf, "b2");
});

test("loadAllChatMessages collects the full chat beyond the copy cap", async () => {
  const allMessages = Array.from({ length: 650 }, (_value, index) => ({
    _id: `msg_${index}`,
    createdAt: index,
  }));

  const ctx = {
    db: {
      query: (table: string) => {
        assert.equal(table, "messages");
        return {
          withIndex: (_index: string, apply: (query: any) => any) => {
            const scoped = apply({
              eq: (field: string, value: unknown) => ({ field, value }),
            });
            assert.deepEqual(scoped, { field: "chatId", value: "chat_big" });
            return {
              order: (direction: string) => {
                assert.equal(direction, "asc");
                return {
                  collect: async () => allMessages,
                };
              },
            };
          },
        };
      },
    },
  } as any;

  const result = await loadAllChatMessages(ctx, "chat_big" as any);

  assert.equal(result.length, 650);
  assert.equal(result[0]._id, "msg_0");
  assert.equal(result[649]._id, "msg_649");
});

test("loadMessagesForFork can fork beyond 500 messages", async () => {
  const allMessages = Array.from({ length: 650 }, (_value, index) => ({
    _id: `msg_${index}`,
    createdAt: index,
  }));

  const ctx = {
    db: {
      query: (table: string) => {
        assert.equal(table, "messages");
        return {
          withIndex: (_index: string, apply: (query: any) => any) => {
            const scoped = apply({
              eq: (field: string, value: unknown) => ({ field, value }),
            });
            assert.deepEqual(scoped, { field: "chatId", value: "chat_big" });
            return {
              order: (direction: string) => {
                assert.equal(direction, "asc");
                return {
                  collect: async () => allMessages,
                };
              },
            };
          },
        };
      },
    },
  } as any;

  const result = await loadMessagesForFork(ctx, "chat_big" as any, "msg_640" as any);

  assert.equal(result.length, 641);
  assert.equal(result[640]._id, "msg_640");
});
