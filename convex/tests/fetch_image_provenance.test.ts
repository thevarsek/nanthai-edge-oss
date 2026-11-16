import assert from "node:assert/strict";
import test from "node:test";

import { fetchImage } from "../tools/fetch_image";
import {
  FETCH_IMAGE_UNTRUSTED_URL_ERROR,
  fetchImageUrlCandidates,
  isCitedSearchUrl,
  searchCitationUrls,
  textContainsUrl,
} from "../tools/fetch_image_provenance";
import { userMessageContainsUrl } from "../tools/fetch_image_queries";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import type { OpenRouterMessage } from "../lib/openrouter_types";

const searchTurn: OpenRouterMessage[] = [
  { role: "user", content: "Find a photo of the bridge" },
  {
    role: "assistant",
    content: null,
    tool_calls: [
      { id: "call_search", type: "function", function: { name: "web_search", arguments: "{}" } },
      { id: "call_other", type: "function", function: { name: "read_text_file", arguments: "{}" } },
    ],
  },
  {
    role: "tool",
    tool_call_id: "call_search",
    content: JSON.stringify({
      summary: "See https://summary-echo.example/q?secret=1",
      citations: ["https://images.example/bridge.jpg"],
      annotations: [{ url_citation: { url: "https://news.example/story" } }],
    }),
  },
  { role: "tool", tool_call_id: "call_other", content: JSON.stringify({ citations: ["https://other.example/x.png"] }) },
];

test("search citations count only from web_search citation fields", () => {
  assert.deepEqual([...searchCitationUrls(searchTurn)].sort(), [
    "https://images.example/bridge.jpg",
    "https://news.example/story",
  ]);
  assert.equal(isCitedSearchUrl(["https://images.example/bridge.jpg"], searchTurn), true);
  assert.equal(isCitedSearchUrl(["https://summary-echo.example/q?secret=1"], searchTurn), false);
  assert.equal(isCitedSearchUrl(["https://other.example/x.png"], searchTurn), false);
  assert.equal(searchCitationUrls(undefined).size, 0);
});

test("URL candidates tolerate the trailing slash URL parsing adds", () => {
  assert.deepEqual(fetchImageUrlCandidates("https://a.example", "https://a.example/"), [
    "https://a.example",
    "https://a.example/",
  ]);
  assert.equal(textContainsUrl("look at https://a.example please", ["https://a.example/", "https://a.example"]), true);
  assert.equal(textContainsUrl("nothing here", ["https://a.example"]), false);
});

test("user message lookup ignores other chats, other users and external MCP results", async () => {
  const rows = {
    chats: [{ _id: "chat_1", userId: "user_1" }, { _id: "chat_2", userId: "user_2" }],
    messages: [
      { _id: "m1", chatId: "chat_1", role: "user", content: "Use https://pasted.example/cat.png" },
      { _id: "m2", chatId: "chat_1", role: "user", source: "external_mcp_result", content: "https://mcp.example/a.png" },
      { _id: "m3", chatId: "chat_1", role: "assistant", content: "https://model.example/b.png" },
      { _id: "m4", chatId: "chat_2", role: "user", content: "https://other-chat.example/c.png" },
    ],
  };
  const ctx = createStatefulMockCtx(rows);
  const lookup = (chatId: string, url: string, userId = "user_1") =>
    (userMessageContainsUrl as any)._handler(ctx, { userId, chatId, candidates: [url] });
  assert.equal(await lookup("chat_1", "https://pasted.example/cat.png"), true);
  assert.equal(await lookup("chat_1", "https://mcp.example/a.png"), false);
  assert.equal(await lookup("chat_1", "https://model.example/b.png"), false);
  assert.equal(await lookup("chat_1", "https://other-chat.example/c.png"), false);
  assert.equal(await lookup("chat_2", "https://other-chat.example/c.png"), false);
  assert.equal(await (userMessageContainsUrl as any)._handler(ctx, { userId: "user_1", chatId: "chat_1", candidates: [] }), false);
});

function toolCtx(options: { userMessageHasUrl: boolean; turnMessages?: OpenRouterMessage[] }) {
  const fetched: string[] = [];
  return {
    fetched,
    ctx: {
      userId: "user_1",
      chatId: "chat_1",
      messageId: "message_1",
      jobId: "job_1",
      executionAttemptId: "attempt_1",
      executionFence: 1,
      toolCallId: "call_fetch",
      turnMessages: options.turnMessages,
      ctx: {
        runQuery: async () => options.userMessageHasUrl,
        runAction: async (_ref: unknown, args: { url: string }) => {
          fetched.push(args.url);
          return { success: true, data: { imageStorageId: "stored" } };
        },
      },
    } as any,
  };
}

test("fetch_image refuses model-composed URLs before any outbound request", async () => {
  const state = toolCtx({ userMessageHasUrl: false });
  const result = await fetchImage.execute(state.ctx, { url: "https://attacker.example/x.png?d=secret" });
  assert.equal(result.success, false);
  assert.equal(result.error, FETCH_IMAGE_UNTRUSTED_URL_ERROR);
  assert.deepEqual(state.fetched, []);

  const tooLong = await fetchImage.execute(state.ctx, { url: `https://a.example/${"x".repeat(2100)}` });
  assert.match(String(tooLong.error), /longer than 2048/);
});

test("fetch_image fetches URLs the user pasted or this turn's search cited", async () => {
  const pasted = toolCtx({ userMessageHasUrl: true });
  assert.equal((await fetchImage.execute(pasted.ctx, { url: "https://pasted.example/cat.png" })).success, true);
  assert.deepEqual(pasted.fetched, ["https://pasted.example/cat.png"]);

  const cited = toolCtx({ userMessageHasUrl: false, turnMessages: searchTurn });
  assert.equal((await fetchImage.execute(cited.ctx, { url: "https://images.example/bridge.jpg" })).success, true);
  assert.deepEqual(cited.fetched, ["https://images.example/bridge.jpg"]);
});
