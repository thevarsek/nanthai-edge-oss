import assert from "node:assert/strict";
import test from "node:test";

import type { Id } from "../_generated/dataModel";
import { buildRequestMessages } from "../chat/helpers";
import type { ContextMessage } from "../chat/helpers_types";
import {
  MAX_IMAGE_CONTEXT_CHARS,
  buildContextualImagePrompt,
  buildImageGenerationRequest,
  imageReferenceUrls,
} from "../chat/image_generation_request";
import type { ContentPart, OpenRouterMessage } from "../lib/openrouter";

function id(value: string): Id<"messages"> {
  return value as unknown as Id<"messages">;
}

function imageUrls(message: OpenRouterMessage | undefined): string[] {
  if (!message || !Array.isArray(message.content)) return [];
  return message.content.flatMap((part: ContentPart) =>
    part.type === "image_url" && part.image_url?.url
      ? [part.image_url.url]
      : []
  );
}

test("generated images survive an intervening text-model turn and branch switch", () => {
  const chatId = "chat_switch" as unknown as Id<"chats">;
  const messages: ContextMessage[] = [
    {
      _id: id("user_1"), chatId, role: "user", content: "Draw a red fox",
      parentMessageIds: [], status: "completed", createdAt: 1,
    },
    {
      _id: id("image_active"), chatId, role: "assistant", content: "",
      modelId: "openai/gpt-image-2", parentMessageIds: [id("user_1")],
      status: "completed", imageUrls: ["https://files.example/fox.png"], createdAt: 2,
    },
    {
      _id: id("image_inactive"), chatId, role: "assistant", content: "",
      modelId: "openai/gpt-image-2", parentMessageIds: [id("user_1")],
      status: "completed", imageUrls: ["https://files.example/inactive.png"], createdAt: 3,
    },
    {
      _id: id("inactive_user"), chatId, role: "user", content: "Use harsh green light",
      parentMessageIds: [id("image_inactive")], status: "completed", createdAt: 3.1,
    },
    {
      _id: id("inactive_reply"), chatId, role: "assistant", content: "Inactive branch note",
      modelId: "openai/gpt-5", parentMessageIds: [id("inactive_user")],
      status: "completed", createdAt: 3.2,
    },
    {
      _id: id("user_2"), chatId, role: "user", content: "Describe its lighting",
      parentMessageIds: [id("image_active")], status: "completed", createdAt: 4,
    },
    {
      _id: id("text_reply"), chatId, role: "assistant", content: "Warm rim lighting.",
      modelId: "openai/gpt-5", parentMessageIds: [id("user_2")],
      status: "completed", createdAt: 5,
    },
    {
      _id: id("user_3"), chatId, role: "user", content: "Now make it moonlit",
      parentMessageIds: [id("text_reply")], status: "completed", createdAt: 6,
    },
    {
      _id: id("pending_image"), chatId, role: "assistant", content: "",
      modelId: "openai/gpt-image-2", parentMessageIds: [id("user_3")],
      status: "pending", createdAt: 7,
    },
  ];

  const textRequest = buildRequestMessages({
    messages,
    excludeMessageId: id("text_reply"),
  });
  assert.deepEqual(
    imageUrls(textRequest.findLast((message) => message.role === "user")),
    ["https://files.example/fox.png"],
  );

  const imageRequestMessages = buildRequestMessages({
    messages,
    excludeMessageId: id("pending_image"),
    systemPrompt: "Render every image as a delicate watercolor.",
  });
  const request = buildImageGenerationRequest({
    model: "openai/gpt-image-2",
    prompt: "Now make it moonlit",
    messages: imageRequestMessages,
    maxInputReferences: 1,
  });
  assert.deepEqual(request.inputReferences, [{
    type: "image_url",
    image_url: { url: "https://files.example/fox.png" },
  }]);
  assert.match(request.prompt, /delicate watercolor/);
  assert.match(request.prompt, /Assistant: Warm rim lighting\./);
  assert.doesNotMatch(request.prompt, /harsh green light|Inactive branch note/);
  assert.doesNotMatch(request.prompt, /files\.example|data:image|base64/);
  assert.ok(request.prompt.endsWith("Current image request:\nNow make it moonlit"));
});

test("current attachments win the reference cap and historical refs are deduplicated", () => {
  const messages: OpenRouterMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: "Earlier" },
        { type: "image_url", image_url: { url: "https://files.example/older.png" } },
        { type: "image_url", image_url: { url: "https://files.example/shared.png" } },
      ],
    },
    { role: "assistant", content: "Looks good" },
    {
      role: "user",
      content: [
        { type: "text", text: "Edit this one" },
        { type: "image_url", image_url: { url: "https://files.example/current.png" } },
        { type: "image_url", image_url: { url: "https://files.example/shared.png" } },
      ],
    },
  ];

  assert.deepEqual(imageReferenceUrls(messages, 2), [
    "https://files.example/current.png",
    "https://files.example/shared.png",
  ]);
  assert.deepEqual(imageReferenceUrls(messages, 4), [
    "https://files.example/current.png",
    "https://files.example/shared.png",
    "https://files.example/older.png",
  ]);
  assert.deepEqual(imageReferenceUrls(messages, undefined), []);
});

test("a live current-turn upload takes precedence over inherited generated images", () => {
  const chatId = "chat_upload" as unknown as Id<"chats">;
  const messages: ContextMessage[] = [
    {
      _id: id("upload_seed"), chatId, role: "user", content: "Make a portrait",
      parentMessageIds: [], status: "completed", createdAt: 1,
    },
    {
      _id: id("upload_prior_image"), chatId, role: "assistant", content: "",
      modelId: "image/model", parentMessageIds: [id("upload_seed")],
      status: "completed", imageUrls: ["https://files.example/generated.png"], createdAt: 2,
    },
    {
      _id: id("upload_user"), chatId, role: "user", content: "Use my upload instead",
      parentMessageIds: [id("upload_prior_image")], status: "completed", createdAt: 3,
      attachments: [{
        type: "image",
        url: "https://files.example/upload.png",
        storageId: "storage_upload",
        name: "upload.png",
        mimeType: "image/png",
      }],
    },
    {
      _id: id("upload_pending"), chatId, role: "assistant", content: "",
      modelId: "image/model", parentMessageIds: [id("upload_user")],
      status: "pending", createdAt: 4,
    },
  ];

  const requestMessages = buildRequestMessages({
    messages,
    excludeMessageId: id("upload_pending"),
  });
  assert.deepEqual(imageReferenceUrls(requestMessages, 1), [
    "https://files.example/upload.png",
  ]);
  assert.deepEqual(imageReferenceUrls(requestMessages, 2), [
    "https://files.example/upload.png",
    "https://files.example/generated.png",
  ]);
});

test("retrying an edit reuses selected parent images but not cancelled output", () => {
  const chatId = "chat_retry" as unknown as Id<"chats">;
  const messages: ContextMessage[] = [
    {
      _id: id("source_user"), chatId, role: "user", content: "Draw a bike",
      parentMessageIds: [], status: "completed", createdAt: 1,
    },
    {
      _id: id("source_image"), chatId, role: "assistant", content: "",
      modelId: "image/model", parentMessageIds: [id("source_user")],
      status: "completed", imageUrls: ["https://files.example/bike.png"], createdAt: 2,
    },
    {
      _id: id("edit_user"), chatId, role: "user", content: "Make it green",
      parentMessageIds: [id("source_image")], status: "completed", createdAt: 3,
    },
    {
      _id: id("cancelled_edit"), chatId, role: "assistant", content: "",
      modelId: "image/model", parentMessageIds: [id("edit_user")],
      status: "cancelled", imageUrls: ["https://files.example/cancelled.png"], createdAt: 4,
    },
    {
      _id: id("retry_pending"), chatId, role: "assistant", content: "",
      modelId: "image/model", parentMessageIds: [id("edit_user")],
      status: "pending", createdAt: 5,
    },
  ];

  const requestMessages = buildRequestMessages({
    messages,
    excludeMessageId: id("retry_pending"),
  });
  assert.deepEqual(imageReferenceUrls(requestMessages, 4), [
    "https://files.example/bike.png",
  ]);
});

test("autonomous assistant-to-assistant turns retain the generated image", () => {
  const chatId = "chat_auto" as unknown as Id<"chats">;
  const messages: ContextMessage[] = [
    {
      _id: id("seed"), chatId, role: "user", content: "Create a concept",
      parentMessageIds: [], status: "completed", createdAt: 1,
    },
    {
      _id: id("auto_image"), chatId, role: "assistant", content: "",
      modelId: "image/model", autonomousParticipantId: "artist",
      parentMessageIds: [id("seed")], status: "completed",
      imageUrls: ["https://files.example/concept.png"], createdAt: 2,
    },
    {
      _id: id("auto_text"), chatId, role: "assistant", content: "Refine the contrast.",
      modelId: "text/model", autonomousParticipantId: "critic",
      parentMessageIds: [id("auto_image")], status: "completed", createdAt: 3,
    },
    {
      _id: id("auto_pending"), chatId, role: "assistant", content: "",
      modelId: "image/model", autonomousParticipantId: "artist",
      parentMessageIds: [id("auto_text")], status: "pending", createdAt: 4,
    },
  ];

  const requestMessages = buildRequestMessages({
    messages,
    excludeMessageId: id("auto_pending"),
    expandMultiModelGroups: false,
  });
  assert.deepEqual(
    imageUrls(requestMessages.findLast((message) => message.role === "user")),
    ["https://files.example/concept.png"],
  );
});

test("context prompt is bounded while preserving the current request verbatim and last", () => {
  const current = "Keep THIS exact request https://example.com/current.png";
  const messages: OpenRouterMessage[] = [
    { role: "system", content: `PERSONA_START ${"S".repeat(20_000)}` },
    ...Array.from({ length: 20 }, (_, index): OpenRouterMessage => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: index === 0
        ? `[Generated image]\ndata:image/png;base64,${"A".repeat(2_000)}\nold-${index}-${"x".repeat(1_000)}`
        : `history-${index}-${"x".repeat(1_000)}`,
    })),
    { role: "user", content: current },
  ];

  const prompt = buildContextualImagePrompt(messages, current);
  const suffix = `\n\nCurrent image request:\n${current}`;
  assert.ok(prompt.endsWith(suffix));
  assert.ok(prompt.slice(0, -suffix.length).length <= MAX_IMAGE_CONTEXT_CHARS);
  assert.match(prompt, /PERSONA_START/);
  assert.match(prompt, /history-19/);
  assert.doesNotMatch(prompt.slice(0, -suffix.length), /data:image|base64|Generated image/);
  assert.equal(prompt.match(/Keep THIS exact request/g)?.length, 1);
});
