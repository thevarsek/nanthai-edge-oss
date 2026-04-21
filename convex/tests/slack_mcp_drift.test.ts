// convex/tests/slack_mcp_drift.test.ts
// =============================================================================
// Unit tests for the Slack MCP drift-detection logic.
//
// Covers:
//   1. shapeFromLive — normalizes live MCP tool entries (sorted, safe on missing fields)
//   2. diffShapes — detects every drift category (missing, new, required, properties)
//   3. SLACK_MCP_TOOLS_SNAPSHOT — every registered NanthAI wrapper tool has a
//      corresponding entry so the drift cron covers everything we ship.
// =============================================================================

import assert from "node:assert/strict";
import test from "node:test";

import {
  diffShapes,
  shapeFromLive,
  type ToolDiff,
} from "../tools/slack/drift_check";
import {
  SLACK_MCP_TOOLS_SNAPSHOT,
  type SlackMcpToolShape,
} from "../tools/slack/mcp_tools_snapshot";
import type { McpTool } from "../tools/slack/mcp_probe";

// ---------------------------------------------------------------------------
// shapeFromLive
// ---------------------------------------------------------------------------

test("shapeFromLive sorts required + properties and tolerates missing inputSchema", () => {
  const tool: McpTool = {
    name: "slack_send_message",
    inputSchema: {
      type: "object",
      properties: {
        thread_ts: {},
        channel_id: {},
        message: {},
        reply_broadcast: {},
      },
      required: ["message", "channel_id"],
    },
  };
  assert.deepEqual(shapeFromLive(tool), {
    name: "slack_send_message",
    required: ["channel_id", "message"],
    properties: ["channel_id", "message", "reply_broadcast", "thread_ts"],
  });
});

test("shapeFromLive returns empty arrays when inputSchema is absent", () => {
  assert.deepEqual(shapeFromLive({ name: "slack_noop" }), {
    name: "slack_noop",
    required: [],
    properties: [],
  });
});

// ---------------------------------------------------------------------------
// diffShapes
// ---------------------------------------------------------------------------

const BASELINE_A: SlackMcpToolShape = {
  name: "slack_send_message",
  required: ["channel_id", "message"],
  properties: ["channel_id", "message", "thread_ts"],
};

test("diffShapes returns no diffs when baseline equals live", () => {
  const diffs = diffShapes([BASELINE_A], [BASELINE_A]);
  assert.deepEqual(diffs, []);
});

test("diffShapes detects a tool missing from the live response", () => {
  const diffs = diffShapes([BASELINE_A], []);
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].kind, "missing_in_live");
  assert.equal(diffs[0].name, "slack_send_message");
});

test("diffShapes detects a new tool added to the live response", () => {
  const diffs = diffShapes(
    [BASELINE_A],
    [
      BASELINE_A,
      { name: "slack_fancy_new_tool", required: ["foo"], properties: ["bar", "foo"] },
    ],
  );
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].kind, "new_in_live");
  assert.equal(diffs[0].name, "slack_fancy_new_tool");
  assert.match(diffs[0].details, /required=\["foo"\]/);
});

test("diffShapes detects required-arg changes", () => {
  const diffs = diffShapes(
    [BASELINE_A],
    [
      {
        name: "slack_send_message",
        required: ["channel_id"], // message dropped
        properties: ["channel_id", "message", "thread_ts"],
      },
    ],
  );
  const kinds = diffs.map((d: ToolDiff) => d.kind);
  assert.ok(kinds.includes("required_changed"));
});

test("diffShapes detects property additions and removals", () => {
  const diffs = diffShapes(
    [BASELINE_A],
    [
      {
        name: "slack_send_message",
        required: ["channel_id", "message"],
        properties: ["channel_id", "message", "reply_broadcast"], // added reply_broadcast, removed thread_ts
      },
    ],
  );
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].kind, "properties_changed");
  assert.match(diffs[0].details, /added=\["reply_broadcast"\]/);
  assert.match(diffs[0].details, /removed=\["thread_ts"\]/);
});

test("diffShapes reports multiple independent drifts", () => {
  const baseline: SlackMcpToolShape[] = [
    BASELINE_A,
    {
      name: "slack_read_channel",
      required: ["channel_id"],
      properties: ["channel_id", "limit"],
    },
  ];
  const live: SlackMcpToolShape[] = [
    {
      name: "slack_send_message",
      required: ["channel_id"], // required drift
      properties: ["channel_id", "message", "thread_ts"],
    },
    // slack_read_channel missing
    {
      name: "slack_brand_new",
      required: [],
      properties: [],
    },
  ];
  const diffs = diffShapes(baseline, live);
  const summary = diffs.map((d) => `${d.kind}:${d.name}`).sort();
  assert.deepEqual(summary, [
    "missing_in_live:slack_read_channel",
    "new_in_live:slack_brand_new",
    "required_changed:slack_send_message",
  ]);
});

// ---------------------------------------------------------------------------
// Snapshot integrity — every NanthAI-exposed tool MUST be in the snapshot,
// otherwise the drift cron silently ignores real changes to that tool.
// ---------------------------------------------------------------------------

test("snapshot covers every MCP tool name NanthAI wrappers invoke", () => {
  // MCP tool names we actually call from tools_messages.ts / tools_search.ts /
  // tools_canvas.ts. Must stay in sync with runSlackTool(...) call sites.
  const wrapperMcpToolNames = [
    "slack_send_message",
    "slack_send_message_draft",
    "slack_schedule_message",
    "slack_read_channel",
    "slack_read_thread",
    "slack_search_public",
    "slack_search_public_and_private",
    "slack_search_channels",
    "slack_search_users",
    "slack_create_canvas",
    "slack_update_canvas",
    "slack_read_canvas",
    "slack_read_user_profile",
  ].sort();

  const snapshotNames = SLACK_MCP_TOOLS_SNAPSHOT.map((t) => t.name).sort();
  assert.deepEqual(snapshotNames, wrapperMcpToolNames);
});

test("snapshot required args are a subset of properties for every tool", () => {
  for (const tool of SLACK_MCP_TOOLS_SNAPSHOT) {
    for (const req of tool.required) {
      assert.ok(
        tool.properties.includes(req),
        `snapshot ${tool.name}: required arg "${req}" missing from properties`,
      );
    }
  }
});

test("snapshot required + properties arrays are sorted (so diff comparisons stay stable)", () => {
  for (const tool of SLACK_MCP_TOOLS_SNAPSHOT) {
    const sortedReq = [...tool.required].sort();
    const sortedProps = [...tool.properties].sort();
    assert.deepEqual(tool.required, sortedReq, `${tool.name}.required is unsorted`);
    assert.deepEqual(tool.properties, sortedProps, `${tool.name}.properties is unsorted`);
  }
});
