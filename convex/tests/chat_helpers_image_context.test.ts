import assert from "node:assert/strict";
import test from "node:test";

import type { Id } from "../_generated/dataModel";
import { buildCurrentDatePrompt, buildRequestMessages } from "../chat/helpers";
import type { ContextMessage } from "../chat/helpers_types";
import type { ContentPart, OpenRouterMessage } from "../lib/openrouter";

function messageParts(message: OpenRouterMessage): ContentPart[] {
  if (typeof message.content === "string") {
    return [{ type: "text", text: message.content }];
  }
  return message.content ?? [];
}

test("buildCurrentDatePrompt formats UTC date/time grounding", () => {
  const prompt = buildCurrentDatePrompt(new Date("2026-04-30T12:34:56.000Z"));

  assert.equal(
    prompt,
    "Today is 30/04/2026. Current date/time: 2026-04-30T12:34:56.000Z (UTC). Use this to resolve relative dates such as today, yesterday, last week, and this week.",
  );
});

test("buildRequestMessages omits volatile date grounding by default for cacheable plain chat", () => {
  const chatId = "chat_date" as unknown as Id<"chats">;
  const user = "m_user_date" as unknown as Id<"messages">;
  const pending = "m_pending_date" as unknown as Id<"messages">;

  const requestMessages = buildRequestMessages({
    messages: [
      {
        _id: user,
        chatId,
        role: "user",
        content: "What day is it?",
        parentMessageIds: [],
        status: "completed",
        createdAt: 1,
      },
      {
        _id: pending,
        chatId,
        role: "assistant",
        content: "",
        parentMessageIds: [user],
        status: "pending",
        createdAt: 2,
      },
    ],
    excludeMessageId: pending,
  });

  assert.equal(requestMessages[0]?.role, "user");
  assert.doesNotMatch(JSON.stringify(requestMessages), /Current date\/time/);
});

test("buildRequestMessages includes injected date grounding when caller requests it", () => {
  const chatId = "chat_date_enabled" as unknown as Id<"chats">;
  const user = "m_user_date_enabled" as unknown as Id<"messages">;
  const pending = "m_pending_date_enabled" as unknown as Id<"messages">;

  const requestMessages = buildRequestMessages({
    messages: [
      {
        _id: user,
        chatId,
        role: "user",
        content: "What is on my calendar tomorrow?",
        parentMessageIds: [],
        status: "completed",
        createdAt: 1,
      },
      {
        _id: pending,
        chatId,
        role: "assistant",
        content: "",
        parentMessageIds: [user],
        status: "pending",
        createdAt: 2,
      },
    ],
    excludeMessageId: pending,
    dateContext: buildCurrentDatePrompt(new Date("2026-04-30T12:34:56.000Z")),
  });

  assert.equal(requestMessages[0]?.role, "system");
  assert.match(String(requestMessages[0]?.content), /^Today is 30\/04\/2026\./);
  assert.match(String(requestMessages[0]?.content), /Current date\/time: 2026-04-30T12:34:56\.000Z/);
});

test("multi-model previous-turn images are attached to the next user turn", () => {
  const chatId = "chat_1" as unknown as Id<"chats">;
  const user1 = "m_user_1" as unknown as Id<"messages">;
  const assistantA1 = "m_assistant_a_1" as unknown as Id<"messages">;
  const assistantB1 = "m_assistant_b_1" as unknown as Id<"messages">;
  const user2 = "m_user_2" as unknown as Id<"messages">;
  const pendingA2 = "m_assistant_a_2" as unknown as Id<"messages">;

  const messages: ContextMessage[] = [
    {
      _id: user1,
      chatId,
      role: "user",
      content: "Create an image of a woman",
      parentMessageIds: [],
      status: "completed",
      createdAt: 1,
    },
    {
      _id: assistantA1,
      chatId,
      role: "assistant",
      content: "[Generated image]",
      modelId: "model/a",
      parentMessageIds: [user1],
      status: "completed",
      imageUrls: ["https://example.com/a.png"],
      isMultiModelResponse: true,
      multiModelGroupId: "group_1",
      createdAt: 2,
    },
    {
      _id: assistantB1,
      chatId,
      role: "assistant",
      content: "[Generated image]",
      modelId: "model/b",
      parentMessageIds: [user1],
      status: "completed",
      imageUrls: ["https://example.com/b.png"],
      isMultiModelResponse: true,
      multiModelGroupId: "group_1",
      createdAt: 3,
    },
    {
      _id: user2,
      chatId,
      role: "user",
      content: "Have them interact together",
      parentMessageIds: [assistantA1, assistantB1],
      status: "completed",
      createdAt: 4,
    },
    {
      _id: pendingA2,
      chatId,
      role: "assistant",
      content: "",
      modelId: "model/a",
      parentMessageIds: [user2],
      status: "pending",
      createdAt: 5,
    },
  ];

  const requestMessages = buildRequestMessages({
    messages,
    excludeMessageId: pendingA2,
    expandMultiModelGroups: true,
  });

  const userTurn = requestMessages.findLast(
    (message: OpenRouterMessage) => message.role === "user",
  );
  assert.ok(userTurn, "expected a user turn in request messages");

  const userParts = messageParts(userTurn!);
  const userImageUrls = userParts
    .filter((part) => part.type === "image_url")
    .map((part) => part.image_url?.url)
    .filter((url): url is string => typeof url === "string");

  assert.deepEqual(userImageUrls.sort(), [
    "https://example.com/a.png",
    "https://example.com/b.png",
  ]);
});

test("buildRequestMessages adds hidden generated document handles to model history", () => {
  const chatId = "chat_doc_context" as unknown as Id<"chats">;
  const user1 = "m_user_doc_1" as unknown as Id<"messages">;
  const assistant1 = "m_assistant_doc_1" as unknown as Id<"messages">;
  const user2 = "m_user_doc_2" as unknown as Id<"messages">;
  const pending = "m_assistant_doc_2" as unknown as Id<"messages">;

  const requestMessages = buildRequestMessages({
    messages: [
      {
        _id: user1,
        chatId,
        role: "user",
        content: "Create a Word document.",
        parentMessageIds: [],
        status: "completed",
        createdAt: 1,
      },
      {
        _id: assistant1,
        chatId,
        role: "assistant",
        content: "Done — I created the Word document.",
        parentMessageIds: [user1],
        status: "completed",
        documentEvents: [{
          type: "document_created",
          documentId: "doc_1",
          versionId: "ver_1",
          storageId: "storage_1",
          generatedFileId: "gf_1",
          filename: "Test Agreement.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          title: "Test Agreement",
        }],
        createdAt: 2,
      },
      {
        _id: user2,
        chatId,
        role: "user",
        content: "Now revise it to add a signature block.",
        parentMessageIds: [assistant1],
        status: "completed",
        createdAt: 3,
      },
      {
        _id: pending,
        chatId,
        role: "assistant",
        content: "",
        parentMessageIds: [user2],
        status: "pending",
        createdAt: 4,
      },
    ],
    excludeMessageId: pending,
  });

  const assistantTurn = requestMessages.find(
    (message: OpenRouterMessage) => message.role === "assistant",
  );
  assert.ok(assistantTurn, "expected prior assistant message in request history");

  const assistantText = messageParts(assistantTurn!)
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");

  assert.match(assistantText, /Done — I created the Word document\./);
  assert.match(assistantText, /Hidden document context from prior assistant output/);
  assert.match(assistantText, /documentId doc_1/);
  assert.match(assistantText, /versionId ver_1/);
  assert.match(assistantText, /storageId storage_1/);
  assert.match(assistantText, /Test Agreement\.docx/);
});
