import type { MutationCtx } from "../_generated/server";

export function isRemoteMcpIntegrationId(integrationId: string): boolean {
  return integrationId.startsWith("mcp:");
}

export async function unknownOwnedRemoteMcpIntegrationIds(
  ctx: Pick<MutationCtx, "db">,
  userId: string,
  integrationIds: string[],
  options: { activeOnly?: boolean } = {},
): Promise<string[]> {
  const requested = [...new Set(integrationIds.filter(isRemoteMcpIntegrationId))];
  if (requested.length === 0) return [];
  const connections = await ctx.db
    .query("mcpConnections")
    .withIndex("by_user", (query) => query.eq("userId", userId))
    .take(1_000);
  const owned = new Set(connections
    .filter((connection) => connection.status !== "disconnecting")
    .filter((connection) => !options.activeOnly || connection.status === "active")
    .map((connection) => connection.integrationId));
  return requested.filter((integrationId) => !owned.has(integrationId));
}
