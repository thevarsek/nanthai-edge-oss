// convex/tools/slack/tools_shared.ts
// =============================================================================
// Helpers shared by all Slack tool wrappers.
// =============================================================================

import { createTool } from "../registry";
import { getSlackAccessToken } from "./auth";
import { callSlackMcpTool } from "./client";

export function extractText(
  content: Array<{ type: string; text?: string }>,
): string {
  return content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text!)
    .join("\n");
}

/** Copy non-empty optional args into mcpArgs. Strips empty strings and undefined. */
export function assignOptional(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.length === 0) continue;
    target[key] = value;
  }
}

export async function runSlackTool(
  toolCtx: Parameters<Parameters<typeof createTool>[0]["execute"]>[0],
  mcpToolName: string,
  mcpArgs: Record<string, unknown>,
): Promise<{ success: boolean; data: string | null; error?: string }> {
  const { accessToken } = await getSlackAccessToken(toolCtx.ctx, toolCtx.userId);
  const result = await callSlackMcpTool(toolCtx, accessToken, mcpToolName, mcpArgs);
  if (result.isError) {
    return { success: false, data: null, error: extractText(result.content) };
  }
  return { success: true, data: extractText(result.content) };
}
