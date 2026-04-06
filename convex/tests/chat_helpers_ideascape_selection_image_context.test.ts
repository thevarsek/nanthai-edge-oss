import assert from "node:assert/strict";
import test from "node:test";

import type { Id } from "../_generated/dataModel";
import { buildRequestMessages } from "../chat/helpers";
import type { ContextMessage } from "../chat/helpers_types";
import type { ContentPart, OpenRouterMessage } from "../lib/openrouter";

function messageParts(message: OpenRouterMessage): ContentPart[] {
  if (typeof message.content === "string") {
    return [{ type: "text", text: message.content }];
  }
  return message.content ?? [];
}

test("ideascape explicit parents keep selected non-immediate assistant images in context", () => {
  const chatId = "chat_i" as unknown as Id<"chats">;
  const user0 = "m_user_0" as unknown as Id<"messages">;
  const assistantA1 = "m_assistant_a_1" as unknown as Id<"messages">;
  const assistantB1 = "m_assistant_b_1" as unknown as Id<"messages">;
  const unrelatedUser = "m_unrelated_user" as unknown as Id<"messages">;
  const unrelatedAssistant = "m_unrelated_assistant" as unknown as Id<"messages">;
  const userIdeascape = "m_user_ideascape" as unknown as Id<"messages">;
  const pendingA2 = "m_assistant_a_2" as unknown as Id<"messages">;

  const messages: ContextMessage[] = [
    {
      _id: user0,
      chatId,
      role: "user",
      content: "Create two portraits",
      parentMessageIds: [],
      status: "completed",
      createdAt: 1,
    },
    {
      _id: assistantA1,
      chatId,
      role: "assistant",
      content: "[Generated image A]",
      modelId: "model/a",
      parentMessageIds: [user0],
      status: "completed",
      imageUrls: ["https://example.com/old-a.png"],
      createdAt: 2,
    },
    {
      _id: assistantB1,
      chatId,
      role: "assistant",
      content: "[Generated image B]",
      modelId: "model/b",
      parentMessageIds: [user0],
      status: "completed",
      imageUrls: ["https://example.com/old-b.png"],
      createdAt: 3,
    },
    {
      _id: unrelatedUser,
      chatId,
      role: "user",
      content: "This is another branch",
      parentMessageIds: [assistantA1],
      status: "completed",
      createdAt: 4,
    },
    {
      _id: unrelatedAssistant,
      chatId,
      role: "assistant",
      content: "Unrelated output",
      modelId: "model/a",
      parentMessageIds: [unrelatedUser],
      status: "completed",
      createdAt: 5,
    },
    {
      _id: userIdeascape,
      chatId,
      role: "user",
      content: "Have them interact together",
      // Explicit ideascape selection: old A + old B nodes.
      parentMessageIds: [assistantA1, assistantB1],
      status: "completed",
      createdAt: 6,
    },
    {
      _id: pendingA2,
      chatId,
      role: "assistant",
      content: "",
      modelId: "model/a",
      parentMessageIds: [userIdeascape],
      status: "pending",
      createdAt: 7,
    },
  ];

  const requestMessages = buildRequestMessages({
    messages,
    excludeMessageId: pendingA2,
    // Ideascape send path: no implicit sibling expansion.
    expandMultiModelGroups: false,
  });

  const userTurn = requestMessages.findLast(
    (message: OpenRouterMessage) => message.role === "user",
  );
  assert.ok(userTurn, "expected ideascape follow-up user turn in request messages");

  const userParts = messageParts(userTurn!);
  const userImageUrls = userParts
    .filter((part) => part.type === "image_url")
    .map((part) => part.image_url?.url)
    .filter((url): url is string => typeof url === "string");

  assert.deepEqual(userImageUrls.sort(), [
    "https://example.com/old-a.png",
    "https://example.com/old-b.png",
  ]);

  // Ensure unrelated branch assistant content isn't pulled into this ideascape path.
  const allText = requestMessages
    .flatMap((message) => messageParts(message))
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
  assert.equal(allText.includes("Unrelated output"), false);
});
