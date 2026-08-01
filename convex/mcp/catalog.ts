"use node";

import { createHash } from "node:crypto";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { loadMcpCatalog, openMcpClient, type McpConnectionCredential } from "./sdk_client";
import { jsonForMcpStorage } from "./json_codec";
import {
  boundedText,
  MCP_MAX_CATALOG_ITEMS,
  MCP_MAX_TOOL_ITEMS,
} from "./policy";
import {
  boundedCatalogJson,
  hashJson,
  normalizeResourceTemplate,
  stableCatalogKey,
} from "./catalog_normalization";

export { boundedCatalogJson, hashJson, stableCatalogKey };

export type CatalogItem = {
  kind: "tool" | "prompt" | "resource" | "resource_template";
  remoteName: string;
  stableKey: string;
  toolAlias?: string;
  title?: string;
  description?: string;
  uri?: string;
  uriTemplate?: string;
  mimeType?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  arguments?: unknown;
  annotations?: unknown;
  metadata?: unknown;
  definitionHash: string;
  disabledReason?: string;
};

export function uniqueCatalogItems(items: readonly CatalogItem[]): CatalogItem[] {
  const unique = new Map<string, CatalogItem>();
  for (const item of items) {
    if (!unique.has(item.stableKey)) unique.set(item.stableKey, item);
  }
  return Array.from(unique.values());
}

const discoveryErrorCodes = new Set([
  "MCP_CATALOG_READ_FAILED",
  "MCP_CATALOG_NORMALIZE_FAILED",
  "MCP_SERVER_METADATA_FAILED",
  "MCP_CATALOG_PERSIST_FAILED",
]);

export function mcpDiscoveryErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !discoveryErrorCodes.has(error.message)) return undefined;
  return error.message;
}

async function discoveryStage<T>(code: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new Error(code, { cause: error });
  }
}

export function stableToolAlias(connectionPublicId: string, remoteName: string): string {
  const connection = connectionPublicId
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-10)
    .toLowerCase() || "server";
  const tool = remoteName
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "") || "tool";
  const digest = createHash("sha256")
    .update(connectionPublicId)
    .update("\0")
    .update(remoteName)
    .digest("hex")
    .slice(0, 16);
  const availableToolLength = 64 - "mcp_".length - connection.length - digest.length - 2;
  return `mcp_${connection}_${tool.slice(0, availableToolLength)}_${digest}`;
}

export function normalizedCatalog(
  publicId: string,
  catalog: Awaited<ReturnType<typeof loadMcpCatalog>>,
): CatalogItem[] {
  const items: CatalogItem[] = [];
  for (const tool of catalog.tools.slice(0, MCP_MAX_TOOL_ITEMS)) {
    const input = boundedCatalogJson(tool.inputSchema);
    const output = boundedCatalogJson(tool.outputSchema);
    const title = boundedText(tool.title, 256);
    const description = boundedText(tool.description, 2000);
    const annotations = boundedCatalogJson(tool.annotations).value;
    const metadata = boundedCatalogJson(tool._meta).value;
    const definition = {
      kind: "tool",
      name: tool.name,
      title,
      description,
      input: input.value,
      output: output.value,
      annotations,
      metadata,
    };
    items.push({
      kind: "tool",
      remoteName: tool.name.slice(0, 256),
      stableKey: stableCatalogKey("tool", tool.name),
      toolAlias: stableToolAlias(publicId, tool.name),
      title,
      description,
      inputSchema: input.value,
      outputSchema: output.value,
      annotations,
      metadata,
      definitionHash: hashJson(definition),
      disabledReason: input.tooLarge || output.tooLarge ? "SCHEMA_TOO_LARGE" : undefined,
    });
  }
  for (const prompt of catalog.prompts) {
    const promptArguments = boundedCatalogJson(prompt.arguments);
    const title = boundedText(prompt.title, 256);
    const description = boundedText(prompt.description, 2000);
    const metadata = boundedCatalogJson(prompt._meta).value;
    items.push({
      kind: "prompt",
      remoteName: prompt.name.slice(0, 256),
      stableKey: stableCatalogKey("prompt", prompt.name),
      title,
      description,
      arguments: promptArguments.value,
      metadata,
      definitionHash: hashJson({
        kind: "prompt",
        name: prompt.name,
        title,
        description,
        arguments: promptArguments.value,
        metadata,
      }),
      disabledReason: promptArguments.tooLarge ? "SCHEMA_TOO_LARGE" : undefined,
    });
  }
  for (const resource of catalog.resources) {
    const title = boundedText(resource.title, 256);
    const description = boundedText(resource.description, 2000);
    const metadata = boundedCatalogJson(resource._meta).value;
    items.push({
      kind: "resource",
      remoteName: resource.name.slice(0, 256),
      stableKey: stableCatalogKey("resource", resource.uri),
      title,
      description,
      uri: resource.uri.slice(0, 2048),
      mimeType: boundedText(resource.mimeType, 256),
      metadata,
      definitionHash: hashJson({
        kind: "resource",
        name: resource.name,
        title,
        description,
        uri: resource.uri,
        mimeType: resource.mimeType,
        metadata,
      }),
    });
  }
  for (const template of catalog.resourceTemplates) {
    items.push(normalizeResourceTemplate(template));
  }
  return jsonForMcpStorage(uniqueCatalogItems(items).slice(0, MCP_MAX_CATALOG_ITEMS)) as CatalogItem[];
}

export async function persistDiscovery(
  ctx: ActionCtx,
  args: {
    userId: string;
    connection: { _id: Id<"mcpConnections">; publicId: string; endpoint: string };
    credential?: McpConnectionCredential;
  },
): Promise<number> {
  const opened = await openMcpClient({
    endpoint: args.connection.endpoint,
    cachePartition: `${args.userId}:${args.connection.publicId}`,
    credential: args.credential,
  });
  try {
    const catalog = await discoveryStage(
      "MCP_CATALOG_READ_FAILED",
      async () => await loadMcpCatalog(opened.client),
    );
    const items = await discoveryStage(
      "MCP_CATALOG_NORMALIZE_FAILED",
      async () => normalizedCatalog(args.connection.publicId, catalog),
    );
    const metadata = await discoveryStage("MCP_SERVER_METADATA_FAILED", async () => {
      const server = opened.client.getServerVersion();
      return {
        serverName: boundedText(server?.name, 256),
        serverVersion: boundedText(server?.version, 128),
        instructions: boundedText(opened.client.getInstructions(), 8000),
        capabilities: jsonForMcpStorage(boundedCatalogJson(opened.client.getServerCapabilities()).value),
        extensions: jsonForMcpStorage(boundedCatalogJson(opened.client.getDiscoverResult()).value),
      };
    });
    await discoveryStage("MCP_CATALOG_PERSIST_FAILED", async () => {
      await ctx.runMutation(internal.mcp.catalog_mutations.replaceCatalog, {
        userId: args.userId,
        connectionId: args.connection._id,
        contentHash: hashJson(items.map((item) => [item.stableKey, item.definitionHash])),
        ...metadata,
        items,
      });
    });
    return items.length;
  } finally {
    await opened.close();
  }
}
