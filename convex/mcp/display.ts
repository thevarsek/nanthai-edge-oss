export interface McpConnectionDisplaySource {
  friendlyName?: string;
  serverName?: string;
  endpointHost: string;
}

export interface McpCatalogItemDisplaySource {
  title?: string;
  remoteName: string;
}

export interface McpCatalogDecisionSource {
  decision: string;
}

export interface McpActiveConnectionOptionSource extends McpConnectionDisplaySource {
  publicId: string;
  integrationId: string;
}

export function mcpConnectionDisplayName(connection: McpConnectionDisplaySource): string {
  return connection.friendlyName?.trim()
    || connection.serverName?.trim()
    || connection.endpointHost;
}

export function mcpCatalogItemDisplayName(item: McpCatalogItemDisplaySource): string {
  const title = item.title?.trim();
  if (title) return title;
  return item.remoteName
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function mcpCatalogCounts(items: readonly McpCatalogDecisionSource[]) {
  return {
    itemCount: items.length,
    allowedItemCount: items.filter((item) => item.decision === "allowed").length,
  };
}

export function mcpActiveConnectionOption(
  connection: McpActiveConnectionOptionSource,
  allowedItemCount: number,
) {
  return {
    connectionId: connection.publicId,
    integrationId: connection.integrationId,
    displayName: mcpConnectionDisplayName(connection),
    friendlyName: connection.friendlyName,
    serverName: connection.serverName,
    endpointHost: connection.endpointHost,
    allowedItemCount,
  };
}
