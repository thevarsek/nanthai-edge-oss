import assert from "node:assert/strict";
import test from "node:test";

import {
  extractSupportedVideoUrlsFromText,
  promoteLatestUserVideoUrls,
} from "../chat/helpers_video_url_utils";
import type { ContentPart, OpenRouterMessage } from "../lib/openrouter";

function contentParts(message: OpenRouterMessage): ContentPart[] {
  if (typeof message.content === "string") {
    return [{ type: "text", text: message.content }];
  }
  return message.content ?? [];
}

test("extractSupportedVideoUrlsFromText canonicalizes and dedupes YouTube URLs", () => {
  const result = extractSupportedVideoUrlsFromText(
    [
      "Check this https://youtu.be/dQw4w9WgXcQ?t=43",
      "and this duplicate https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share",
    ].join(" "),
  );

  assert.deepEqual(result.urls, [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  ]);
  assert.deepEqual(
    result.events.map((event) => event.status),
    ["promoted"],
  );
});

test("extractSupportedVideoUrlsFromText reports malformed and non-public YouTube URLs", () => {
  const result = extractSupportedVideoUrlsFromText(
    [
      "Bad watch URL https://www.youtube.com/watch?list=PL123",
      "Bad short URL https://youtu.be/not-a-real-id",
      "Non-YouTube URL https://example.com/video",
    ].join(" "),
  );

  assert.deepEqual(result.urls, []);
  assert.deepEqual(result.events, [
    {
      status: "skipped",
      url: "https://www.youtube.com/watch?list=PL123",
      reason: "non_public_url",
    },
    {
      status: "skipped",
      url: "https://youtu.be/not-a-real-id",
      reason: "non_public_url",
    },
  ]);
});

test("promoteLatestUserVideoUrls appends video_url parts only to the latest user turn", () => {
  const messages: OpenRouterMessage[] = [
    {
      role: "user",
      content: "First link https://youtu.be/dQw4w9WgXcQ",
    },
    {
      role: "assistant",
      content: "I saw it.",
    },
    {
      role: "user",
      content: "Summarize this https://www.youtube.com/watch?v=9bZkp7q19f0",
    },
  ];

  const result = promoteLatestUserVideoUrls(messages, {
    modelId: "google/gemini-2.5-pro",
    provider: "google",
    hasVideoInput: true,
  });

  const firstUserParts = contentParts(result.messages[0]);
  assert.equal(
    firstUserParts.some((part) => part.type === "video_url"),
    false,
  );

  const latestUserParts = contentParts(result.messages[2]);
  assert.deepEqual(latestUserParts, [
    {
      type: "text",
      text: "Summarize this https://www.youtube.com/watch?v=9bZkp7q19f0",
    },
    {
      type: "video_url",
      video_url: {
        url: "https://www.youtube.com/watch?v=9bZkp7q19f0",
      },
    },
  ]);
  assert.deepEqual(result.events, [
    {
      status: "promoted",
      url: "https://www.youtube.com/watch?v=9bZkp7q19f0",
    },
  ]);
});

test("promoteLatestUserVideoUrls keeps YouTube links as text when the model lacks video input", () => {
  const messages: OpenRouterMessage[] = [
    {
      role: "user",
      content: "Watch https://youtu.be/dQw4w9WgXcQ",
    },
  ];

  const result = promoteLatestUserVideoUrls(messages, {
    modelId: "openai/gpt-5",
    provider: "openai",
    hasVideoInput: false,
  });

  assert.deepEqual(result.messages, messages);
  assert.deepEqual(result.events, [
    {
      status: "skipped",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      reason: "unsupported_model",
    },
  ]);
});
