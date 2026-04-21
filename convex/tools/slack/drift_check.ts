// convex/tools/slack/drift_check.ts
// =============================================================================
// Weekly cron job: compares Slack's live MCP tools/list response to our
// committed baseline snapshot (mcp_tools_snapshot.ts). Logs warnings when
// Slack renames tools or changes required/optional args, so we can update
// our hardcoded schemas before users hit broken tool calls.
//
// Strategy:
//   1. Find any active Slack OAuth connection (drift affects everyone, so any
//      user's token is fine for a read-only tools/list call).
//   2. If no active connection exists, skip silently (no users to break).
//   3. Otherwise fetch live tools, compute a diff, console.log results.
//
// The cron NEVER auto-updates the baseline. Drift must be reviewed and the
// snapshot + wrappers updated manually.
// =============================================================================

import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { fetchLiveMcpTools, type McpTool } from "./mcp_probe";
import {
  SLACK_MCP_TOOLS_SNAPSHOT,
  type SlackMcpToolShape,
} from "./mcp_tools_snapshot";

interface ToolDiff {
  name: string;
  kind: "missing_in_live" | "new_in_live" | "required_changed" | "properties_changed";
  details: string;
}

export type { ToolDiff };

export function shapeFromLive(tool: McpTool): SlackMcpToolShape {
  const schema = tool.inputSchema ?? {};
  const required = [...(schema.required ?? [])].sort();
  const properties = Object.keys(schema.properties ?? {}).sort();
  return { name: tool.name, required, properties };
}

function sameArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function diffShapes(
  baseline: SlackMcpToolShape[],
  live: SlackMcpToolShape[],
): ToolDiff[] {
  const diffs: ToolDiff[] = [];
  const baselineByName = new Map(baseline.map((t) => [t.name, t]));
  const liveByName = new Map(live.map((t) => [t.name, t]));

  for (const baseTool of baseline) {
    const liveTool = liveByName.get(baseTool.name);
    if (!liveTool) {
      diffs.push({
        name: baseTool.name,
        kind: "missing_in_live",
        details: `Tool "${baseTool.name}" is in snapshot but missing from live tools/list.`,
      });
      continue;
    }
    if (!sameArray(baseTool.required, liveTool.required)) {
      diffs.push({
        name: baseTool.name,
        kind: "required_changed",
        details:
          `required changed: baseline=${JSON.stringify(baseTool.required)} ` +
          `live=${JSON.stringify(liveTool.required)}`,
      });
    }
    if (!sameArray(baseTool.properties, liveTool.properties)) {
      const added = liveTool.properties.filter(
        (p) => !baseTool.properties.includes(p),
      );
      const removed = baseTool.properties.filter(
        (p) => !liveTool.properties.includes(p),
      );
      diffs.push({
        name: baseTool.name,
        kind: "properties_changed",
        details: `properties changed: added=${JSON.stringify(added)} removed=${JSON.stringify(removed)}`,
      });
    }
  }

  for (const liveTool of live) {
    if (!baselineByName.has(liveTool.name)) {
      diffs.push({
        name: liveTool.name,
        kind: "new_in_live",
        details:
          `New tool "${liveTool.name}" in live tools/list not present in snapshot. ` +
          `required=${JSON.stringify(liveTool.required)} ` +
          `properties=${JSON.stringify(liveTool.properties)}`,
      });
    }
  }

  return diffs;
}

/**
 * Compare Slack's live MCP tool schemas to our committed snapshot.
 * Registered as a weekly cron in convex/crons.ts.
 */
export const checkSlackMcpDrift = internalAction({
  args: {},
  handler: async (ctx) => {
    const connection = await ctx.runQuery(
      internal.oauth.slack.pickAnyActiveConnection,
      {},
    );
    if (!connection) {
      console.log("[slack-drift] No active Slack connections; skipping drift check.");
      return { skipped: true, reason: "no_active_connection" };
    }

    let liveTools: McpTool[];
    try {
      liveTools = await fetchLiveMcpTools(connection.accessToken);
    } catch (err) {
      console.warn(
        `[slack-drift] Live tools/list failed — cannot check drift: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { skipped: true, reason: "live_fetch_failed" };
    }

    const liveShapes = liveTools.map(shapeFromLive);
    const diffs = diffShapes(SLACK_MCP_TOOLS_SNAPSHOT, liveShapes);

    if (diffs.length === 0) {
      console.log(
        `[slack-drift] OK — ${liveShapes.length} live tools match snapshot.`,
      );
      return { skipped: false, driftCount: 0, driftDetails: [] };
    }

    console.warn(
      `[slack-drift] DRIFT DETECTED in Slack MCP tools/list (${diffs.length} change(s)). ` +
        `Update convex/tools/slack/mcp_tools_snapshot.ts and the matching wrapper in ` +
        `tools_messages.ts / tools_search.ts / tools_canvas.ts.`,
    );
    for (const diff of diffs) {
      console.warn(`[slack-drift] [${diff.kind}] ${diff.name}: ${diff.details}`);
    }

    return {
      skipped: false,
      driftCount: diffs.length,
      driftDetails: diffs,
    };
  },
});
