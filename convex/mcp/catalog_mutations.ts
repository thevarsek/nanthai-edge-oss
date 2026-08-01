import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { assertUserDataWritable } from "../lib/write_fence";

const catalogKind = v.union(
  v.literal("tool"),
  v.literal("prompt"),
  v.literal("resource"),
  v.literal("resource_template"),
);

export function statusAfterCatalogRefresh(status: string): "active" | "disabled" | "reviewing" {
  if (status === "active" || status === "disabled") return status;
  return "reviewing";
}

export const replaceCatalog = internalMutation({
  args: {
    userId: v.string(),
    connectionId: v.id("mcpConnections"),
    contentHash: v.string(),
    serverName: v.optional(v.string()),
    serverVersion: v.optional(v.string()),
    instructions: v.optional(v.string()),
    capabilities: v.optional(v.any()),
    extensions: v.optional(v.any()),
    items: v.array(v.object({
      kind: catalogKind,
      remoteName: v.string(),
      stableKey: v.string(),
      toolAlias: v.optional(v.string()),
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      uri: v.optional(v.string()),
      uriTemplate: v.optional(v.string()),
      mimeType: v.optional(v.string()),
      inputSchema: v.optional(v.any()),
      outputSchema: v.optional(v.any()),
      arguments: v.optional(v.any()),
      annotations: v.optional(v.any()),
      metadata: v.optional(v.any()),
      definitionHash: v.string(),
      disabledReason: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    await assertUserDataWritable(ctx, args.userId);
    if (new Set(args.items.map((item) => item.stableKey)).size !== args.items.length) {
      throw new Error("MCP catalog contains duplicate stable keys.");
    }
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.userId !== args.userId) throw new Error("MCP connection missing.");
    const oldItems = await ctx.db
      .query("mcpCatalogItems")
      .withIndex("by_connection", (q) => q.eq("connectionId", args.connectionId))
      .collect();
    const oldByStableKey = new Map(oldItems.map((item) => [item.stableKey, item]));
    const priorSnapshots = await ctx.db
      .query("mcpCatalogSnapshots")
      .withIndex("by_connection", (q) => q.eq("connectionId", args.connectionId))
      .collect();
    const revision = priorSnapshots.reduce((max, row) => Math.max(max, row.revision), 0) + 1;
    const now = Date.now();
    const snapshotId = await ctx.db.insert("mcpCatalogSnapshots", {
      userId: args.userId,
      connectionId: args.connectionId,
      revision,
      itemCount: args.items.length,
      contentHash: args.contentHash,
      cacheScope: "private",
      createdAt: now,
    });
    for (const item of args.items) {
      const old = oldByStableKey.get(item.stableKey);
      const decision = old?.definitionHash === item.definitionHash ? old.decision : "disabled";
      await ctx.db.insert("mcpCatalogItems", {
        ...item,
        userId: args.userId,
        connectionId: args.connectionId,
        snapshotId,
        decision,
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
      });
    }
    for (const old of oldItems) await ctx.db.delete(old._id);
    for (const snapshot of priorSnapshots) await ctx.db.delete(snapshot._id);
    await ctx.db.patch(args.connectionId, {
      status: statusAfterCatalogRefresh(connection.status),
      protocolVersion: "2026-07-28",
      supportedVersions: ["2026-07-28"],
      serverName: args.serverName,
      serverVersion: args.serverVersion,
      instructions: args.instructions,
      capabilities: args.capabilities,
      extensions: args.extensions,
      lastCheckedAt: now,
      lastSuccessAt: now,
      lastErrorCode: undefined,
      updatedAt: now,
    });
    return null;
  },
});
