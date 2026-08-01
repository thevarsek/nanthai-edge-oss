import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { RemoteMcpToolDefinition } from "./tool_registry";

export interface RemoteMcpToolCallDisplayMetadata {
  source: "remote_mcp";
  displayName: string;
  integrationId: string;
  integrationName: string;
}

export async function loadAllowedRemoteMcpToolsForChat(
  ctx: Pick<ActionCtx, "runQuery">,
  args: {
    userId: string;
    integrationIds: string[];
    isPro: boolean;
    toolsDisabled: boolean;
  },
): Promise<RemoteMcpToolDefinition[]> {
  if (!args.isPro || args.toolsDisabled) return [];
  return await ctx.runQuery(internal.mcp.queries.listAllowedToolsForIntegrations, {
    userId: args.userId,
    integrationIds: args.integrationIds,
  });
}

export function remoteMcpToolCallDisplayMetadata(
  definitions: RemoteMcpToolDefinition[],
): Record<string, RemoteMcpToolCallDisplayMetadata> {
  const metadata: Record<string, RemoteMcpToolCallDisplayMetadata> = {};
  for (const definition of definitions) {
    if (!definition.alias || metadata[definition.alias]) continue;
    metadata[definition.alias] = {
      source: "remote_mcp",
      displayName: definition.displayName,
      integrationId: definition.integrationId,
      integrationName: definition.integrationName,
    };
  }
  return metadata;
}
