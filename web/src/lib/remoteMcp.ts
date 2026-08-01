export interface RemoteMcpConnectionOption {
  connectionId: string;
  integrationId: string;
  displayName: string;
  friendlyName?: string;
  serverName?: string;
  endpointHost: string;
  allowedItemCount: number;
}

export function enabledRemoteMcpConnectionIds(
  connections: readonly RemoteMcpConnectionOption[] | undefined,
  enabledIntegrationIds: ReadonlySet<string>,
): string[] {
  return (connections ?? [])
    .filter((connection) => enabledIntegrationIds.has(connection.integrationId))
    .map((connection) => connection.connectionId)
    .sort();
}

export function filterRemoteMcpContentForEnabledConnections<T extends { connectionId: string }>(
  items: readonly T[] | undefined,
  enabledConnectionIds: readonly string[],
): T[] | undefined {
  if (items === undefined) return undefined;
  const enabledIds = new Set(enabledConnectionIds);
  return items.filter((item) => enabledIds.has(item.connectionId));
}

export function stagedRemoteMcpContextsForChat<
  T extends { chatId: string; connectionId: string },
>(
  contexts: readonly T[],
  chatId: string | undefined,
  enabledConnectionIds: ReadonlySet<string>,
): T[] {
  if (!chatId) return [];
  return contexts.filter((context) =>
    context.chatId === chatId && enabledConnectionIds.has(context.connectionId),
  );
}
