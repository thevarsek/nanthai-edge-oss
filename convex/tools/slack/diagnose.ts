// convex/tools/slack/diagnose.ts
// =============================================================================
// One-off diagnostic: performs the MCP handshake against https://mcp.slack.com/mcp
// for a given user, then calls `tools/list` and returns the full tool schemas.
//
// Used to confirm the actual argument-key names Slack's hosted MCP server
// expects (e.g. whether slack_send_message takes `text` or `message`).
//
// Run with:
//   CONVEX_URL=<your-dev-deployment-url> \
//     npx convex run tools/slack/diagnose:listSlackMcpTools '{"userId":"<USER_ID>"}'
//
// SAFE TO KEEP: internalAction, read-only, no writes, no side effects.
// =============================================================================

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { fetchLiveMcpTools } from "./mcp_probe";

export const listSlackMcpTools = internalAction({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const connection = await ctx.runQuery(
      internal.oauth.slack.getConnectionInternal,
      { userId },
    );
    if (!connection) {
      throw new Error(`No Slack connection for user ${userId}.`);
    }

    const tools = await fetchLiveMcpTools(connection.accessToken);

    for (const tool of tools) {
      console.log(
        `\n=== ${tool.name} ===\n` +
          `description: ${tool.description ?? "(none)"}\n` +
          `inputSchema: ${JSON.stringify(tool.inputSchema, null, 2)}`,
      );
    }

    return {
      toolCount: tools.length,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  },
});
