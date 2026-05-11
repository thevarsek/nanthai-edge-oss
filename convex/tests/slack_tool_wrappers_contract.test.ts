import assert from "node:assert/strict";
import test, { mock } from "node:test";

import {
  slackCreateCanvas,
  slackReadUserProfile,
  slackUpdateCanvas,
} from "../tools/slack/tools_canvas";
import {
  slackReadChannel,
  slackReadThread,
  slackScheduleMessage,
  slackSendMessage,
  slackSendMessageDraft,
} from "../tools/slack/tools_messages";
import {
  slackSearchChannels,
  slackSearchMessages,
  slackSearchUsers,
} from "../tools/slack/tools_search";
import { assignOptional, extractText } from "../tools/slack/tools_shared";

function slackToolCtx() {
  const mutations: Array<Record<string, unknown>> = [];
  return {
    mutations,
    toolCtx: {
      userId: "user_1",
      ctx: {
        runQuery: async () => ({
          _id: "connection_1",
          userId: "user_1",
          provider: "slack",
          accessToken: "xoxp-token",
          refreshToken: "refresh",
          expiresAt: Date.now() + 60 * 60 * 1000,
          scopes: ["search:read", "chat:write"],
          status: "active",
          connectedAt: Date.now(),
        }),
        runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
          mutations.push(args);
          if ("leaseMs" in args) {
            return { granted: true, waitMs: 0 };
          }
          return null;
        },
      },
    } as any,
  };
}

test("Slack shared helpers extract text and copy only meaningful optional args", () => {
  const target: Record<string, unknown> = { query: "release notes" };
  assignOptional(target, {
    cursor: "next",
    empty: "",
    nil: null,
    missing: undefined,
    include_bots: false,
    limit: 0,
  });

  assert.deepEqual(target, {
    query: "release notes",
    cursor: "next",
    include_bots: false,
    limit: 0,
  });
  assert.equal(
    extractText([
      { type: "image", text: "ignored" },
      { type: "text", text: "first" },
      { type: "text" },
      { type: "text", text: "second" },
    ]),
    "first\nsecond",
  );
});

test("Slack tool wrappers map NanthAI args to MCP tool names, clamped limits, and optional fields", async () => {
  const { toolCtx, mutations } = slackToolCtx();
  const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        id?: number;
        method: string;
        params?: { name?: string; arguments?: Record<string, unknown> };
      };
      if (body.method === "tools/call") {
        toolCalls.push({
          name: String(body.params?.name),
          args: body.params?.arguments ?? {},
        });
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [
              { type: "text", text: `called ${body.params?.name}` },
              { type: "image", url: "https://example.com/ignored.png" },
            ],
          },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: {},
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "mcp-session-id": "session_1",
        },
      });
    },
  );

  const privateSearch = await slackSearchMessages.execute(toolCtx, {
    query: "incident review",
    limit: 99,
    max_context_length: 500,
    channel_types: "public_channel,private_channel",
    include_context: false,
  });
  const publicSearch = await slackSearchMessages.execute(toolCtx, {
    query: "roadmap",
    include_private: false,
    channel_types: "private_channel",
    limit: -10,
  });
  const channelSearch = await slackSearchChannels.execute(toolCtx, {
    query: "eng",
    limit: 50,
    include_archived: false,
  });
  const userSearch = await slackSearchUsers.execute(toolCtx, {
    query: "Dino",
    limit: 0,
    response_format: "concise",
  });
  const sent = await slackSendMessage.execute(toolCtx, {
    channel_id: "C1",
    message: "Ship it",
    thread_ts: "",
    reply_broadcast: true,
  });
  const draft = await slackSendMessageDraft.execute(toolCtx, {
    channel_id: "C1",
    message: "Draft",
    thread_ts: "123.45",
  });
  const scheduled = await slackScheduleMessage.execute(toolCtx, {
    channel_id: "C1",
    message: "Later",
    post_at: 1_800_000_000.9,
  });
  const channel = await slackReadChannel.execute(toolCtx, {
    channel_id: "C1",
    limit: 101,
    latest: "999.0",
  });
  const thread = await slackReadThread.execute(toolCtx, {
    channel_id: "C1",
    message_ts: "100.0",
    limit: 0,
  });
  const canvas = await slackCreateCanvas.execute(toolCtx, {
    title: "Launch",
    content: "# Plan",
  });
  const updatedCanvas = await slackUpdateCanvas.execute(toolCtx, {
    canvas_id: "F1",
    action: "replace",
    content: "Updated",
    section_id: "",
  });
  const profile = await slackReadUserProfile.execute(toolCtx, {
    user_id: "",
    include_locale: true,
    response_format: "detailed",
  });

  for (const result of [
    privateSearch,
    publicSearch,
    channelSearch,
    userSearch,
    sent,
    draft,
    scheduled,
    channel,
    thread,
    canvas,
    updatedCanvas,
    profile,
  ]) {
    assert.equal(result.success, true);
    assert.match(String(result.data), /^called slack_/);
  }

  assert.deepEqual(toolCalls.map((call) => call.name), [
    "slack_search_public_and_private",
    "slack_search_public",
    "slack_search_channels",
    "slack_search_users",
    "slack_send_message",
    "slack_send_message_draft",
    "slack_schedule_message",
    "slack_read_channel",
    "slack_read_thread",
    "slack_create_canvas",
    "slack_update_canvas",
    "slack_read_user_profile",
  ]);
  assert.deepEqual(toolCalls[0].args, {
    query: "incident review",
    limit: 20,
    max_context_length: 500,
    include_context: false,
    channel_types: "public_channel,private_channel",
  });
  assert.deepEqual(toolCalls[1].args, { query: "roadmap", limit: 1 });
  assert.equal(toolCalls[2].args.limit, 20);
  assert.equal(toolCalls[3].args.limit, 1);
  assert.deepEqual(toolCalls[4].args, {
    channel_id: "C1",
    message: "Ship it",
    reply_broadcast: true,
  });
  assert.equal(toolCalls[5].args.thread_ts, "123.45");
  assert.equal(toolCalls[6].args.post_at, 1_800_000_000);
  assert.equal(toolCalls[7].args.limit, 100);
  assert.equal(toolCalls[8].args.limit, 1);
  assert.deepEqual(toolCalls[9].args, { title: "Launch", content: "# Plan" });
  assert.deepEqual(toolCalls[10].args, {
    canvas_id: "F1",
    action: "replace",
    content: "Updated",
  });
  assert.deepEqual(toolCalls[11].args, {
    include_locale: true,
    response_format: "detailed",
  });
  assert.equal(mutations.filter((entry) => "leaseMs" in entry).length, 24);
  assert.equal(mutations.filter((entry) => "nextAllowedAt" in entry).length, 24);

  fetchMock.mock.restore();
});
