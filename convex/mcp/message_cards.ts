import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { mcpCatalogItemDisplayName, mcpConnectionDisplayName } from "./display";

export type McpContextCard = {
  invocationId: string;
  label: string;
  serverName: string;
  kind: "prompt" | "resource" | "resource_template";
};

export async function mcpContextCardsByMessage(
  ctx: QueryCtx,
  messages: Doc<"messages">[],
): Promise<Map<string, McpContextCard[]>> {
  const invocationIds = [...new Set(messages.flatMap((message) => message.mcpInvocationIds ?? []))];
  const invocations = (await Promise.all(invocationIds.map((id) => ctx.db.get(id))))
    .filter((invocation): invocation is Doc<"mcpInvocations"> =>
      invocation !== null && invocation.kind !== "tool");
  const itemIds = [...new Set(invocations.flatMap((invocation) =>
    invocation.catalogItemId ? [invocation.catalogItemId] : []))];
  const connectionIds = [...new Set(invocations.map((invocation) => invocation.connectionId))];
  const [items, connections] = await Promise.all([
    Promise.all(itemIds.map((id) => ctx.db.get(id))),
    Promise.all(connectionIds.map((id) => ctx.db.get(id))),
  ]);
  const invocationById = new Map(invocations.map((invocation) => [String(invocation._id), invocation]));
  const itemById = new Map(items
    .filter((item): item is Doc<"mcpCatalogItems"> => item !== null)
    .map((item) => [String(item._id), item]));
  const connectionById = new Map(
    connections
      .filter((connection): connection is Doc<"mcpConnections"> => connection !== null)
      .map((connection) => [String(connection._id), connection]),
  );
  const cardsByMessage = new Map<string, McpContextCard[]>();

  for (const message of messages) {
    const cards: McpContextCard[] = [];
    for (const invocationId of message.mcpInvocationIds ?? []) {
      const invocation = invocationById.get(String(invocationId));
      if (!invocation || invocation.userId !== message.userId || invocation.kind === "tool") continue;
      const item = invocation.catalogItemId
        ? itemById.get(String(invocation.catalogItemId))
        : undefined;
      const connection = connectionById.get(String(invocation.connectionId));
      const label = invocation.itemName ?? (item ? mcpCatalogItemDisplayName(item) : undefined);
      if (!label || (connection && connection.userId !== message.userId)) continue;
      cards.push({
        invocationId: invocation.publicId,
        label,
        serverName: connection
          ? mcpConnectionDisplayName(connection)
          : "Disconnected Remote MCP server",
        kind: invocation.kind,
      });
    }
    if (cards.length > 0) cardsByMessage.set(String(message._id), cards);
  }

  return cardsByMessage;
}
