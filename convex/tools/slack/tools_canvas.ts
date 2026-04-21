// convex/tools/slack/tools_canvas.ts
// =============================================================================
// Slack Canvas tools + read_user_profile.
// =============================================================================

import { createTool } from "../registry";
import { assignOptional, runSlackTool } from "./tools_shared";

// ---------------------------------------------------------------------------
// slack_create_canvas  (MCP: slack_create_canvas)
// ---------------------------------------------------------------------------

export const slackCreateCanvas = createTool({
  name: "slack_create_canvas",
  description:
    "Create a Slack Canvas document from Canvas-flavored markdown. Not available on free teams. " +
    "NOTE: Slack does not accept a channel param here — share the returned canvas URL separately.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Canvas title (do not repeat in content)." },
      content: {
        type: "string",
        description:
          "Canvas-flavored markdown. Standard headings/lists/links. For user/channel refs use " +
          "![](@U123...) and ![](#C123...) syntax. See Slack Canvas formatting docs.",
      },
    },
    required: ["title", "content"],
  },
  execute: async (toolCtx, args) => {
    return runSlackTool(toolCtx, "slack_create_canvas", {
      title: args.title,
      content: args.content,
    });
  },
});

// ---------------------------------------------------------------------------
// slack_update_canvas  (MCP: slack_update_canvas)
// ---------------------------------------------------------------------------

export const slackUpdateCanvas = createTool({
  name: "slack_update_canvas",
  description:
    "Update an existing Slack Canvas. action is one of append|prepend|replace. " +
    "DANGER: action='replace' WITHOUT section_id overwrites the ENTIRE canvas. Call " +
    "slack_read_canvas first to get a section_id when replacing a specific section.",
  parameters: {
    type: "object",
    properties: {
      canvas_id: { type: "string", description: "Canvas ID (e.g. F0123ABC456)." },
      action: { type: "string", description: "'append' (default), 'prepend', or 'replace'." },
      content: { type: "string", description: "Canvas-flavored markdown to insert/replace." },
      section_id: {
        type: "string",
        description:
          "Optional section ID from slack_read_canvas. Strongly recommended with action=replace.",
      },
    },
    required: ["canvas_id", "action", "content"],
  },
  execute: async (toolCtx, args) => {
    const mcpArgs: Record<string, unknown> = {
      canvas_id: args.canvas_id,
      action: args.action,
      content: args.content,
    };
    assignOptional(mcpArgs, { section_id: args.section_id });
    return runSlackTool(toolCtx, "slack_update_canvas", mcpArgs);
  },
});

// ---------------------------------------------------------------------------
// slack_read_canvas  (MCP: slack_read_canvas)
// ---------------------------------------------------------------------------

export const slackReadCanvas = createTool({
  name: "slack_read_canvas",
  description:
    "Read a Slack Canvas as markdown, including section_id_mapping used for targeted updates.",
  parameters: {
    type: "object",
    properties: {
      canvas_id: { type: "string", description: "Canvas ID." },
    },
    required: ["canvas_id"],
  },
  execute: async (toolCtx, args) => {
    return runSlackTool(toolCtx, "slack_read_canvas", { canvas_id: args.canvas_id });
  },
});

// ---------------------------------------------------------------------------
// slack_read_user_profile  (MCP: slack_read_user_profile)
// ---------------------------------------------------------------------------

export const slackReadUserProfile = createTool({
  name: "slack_read_user_profile",
  description:
    "Read a Slack user's profile (name, title, email, status, timezone, org, role). " +
    "Omit user_id to read the current user.",
  parameters: {
    type: "object",
    properties: {
      user_id: {
        type: "string",
        description: "Slack user ID (U...). Defaults to current user when omitted.",
      },
      include_locale: { type: "boolean", description: "Include locale info (default false)." },
      response_format: { type: "string", description: "'detailed' (default) or 'concise'." },
    },
    required: [],
  },
  execute: async (toolCtx, args) => {
    const mcpArgs: Record<string, unknown> = {};
    assignOptional(mcpArgs, {
      user_id: args.user_id,
      include_locale: args.include_locale,
      response_format: args.response_format,
    });
    return runSlackTool(toolCtx, "slack_read_user_profile", mcpArgs);
  },
});
