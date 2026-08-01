"use node";

import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { boundedText, MCP_MAX_RESULT_BYTES } from "./policy";

export type McpInvocationContentItem = {
  kind: "text" | "image" | "audio" | "blob" | "resource_link";
  role?: string;
  text?: string;
  storageId?: Id<"_storage">;
  mimeType?: string;
  name?: string;
  uri?: string;
  sizeBytes?: number;
};

const MAX_ITEMS = 24;
const MAX_CONTEXT_CHARS = 48_000;

export async function deleteMcpInvocationContent(
  ctx: ActionCtx,
  items: McpInvocationContentItem[] | undefined,
): Promise<void> {
  await Promise.all((items ?? []).map(async (item) => {
    if (item.storageId) await ctx.storage.delete(item.storageId).catch(() => undefined);
  }));
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function contentArrays(result: unknown): Array<{ role?: string; values: unknown[] }> {
  const root = record(result) ?? {};
  const arrays: Array<{ role?: string; values: unknown[] }> = [];
  if (Array.isArray(root.messages)) {
    for (const message of root.messages) {
      const row = record(message);
      if (!row) continue;
      arrays.push({
        role: string(row.role),
        values: Array.isArray(row.content) ? row.content : [row.content],
      });
    }
  }
  for (const key of ["contents", "content"]) {
    const value = root[key];
    if (Array.isArray(value)) arrays.push({ values: value });
    else if (value !== undefined) arrays.push({ values: [value] });
  }
  return arrays;
}

function binaryPayload(row: Record<string, unknown>): { data: string; mimeType: string } | undefined {
  const data = string(row.data) ?? string(row.blob);
  if (!data) return undefined;
  const mimeType = string(row.mimeType) ?? string(row.mime_type) ?? "application/octet-stream";
  return { data, mimeType };
}

async function mapOne(
  ctx: ActionCtx,
  value: unknown,
  role?: string,
): Promise<McpInvocationContentItem[]> {
  if (typeof value === "string") return [{ kind: "text", role, text: boundedText(value, 16_000) }];
  const row = record(value);
  if (!row) return [];
  const type = string(row.type)?.toLowerCase();
  const embedded = record(row.resource);
  if (embedded) return await mapOne(ctx, embedded, role);
  const text = string(row.text);
  if (text) return [{ kind: "text", role, text: boundedText(text, 16_000) }];
  const binary = binaryPayload(row);
  if (binary) {
    const bytes = Buffer.from(binary.data, "base64");
    if (bytes.byteLength > MCP_MAX_RESULT_BYTES) throw new Error("MCP_CONTENT_TOO_LARGE");
    const storageId = await ctx.storage.store(new Blob([bytes], { type: binary.mimeType }));
    const kind = type === "image" || binary.mimeType.startsWith("image/")
      ? "image"
      : type === "audio" || binary.mimeType.startsWith("audio/")
        ? "audio"
        : "blob";
    return [{
      kind,
      role,
      storageId,
      mimeType: binary.mimeType,
      name: string(row.name),
      uri: string(row.uri),
      sizeBytes: bytes.byteLength,
    }];
  }
  const uri = string(row.uri) ?? string(row.href);
  if (uri) return [{
    kind: "resource_link",
    role,
    uri,
    name: string(row.name) ?? string(row.title),
    mimeType: string(row.mimeType),
  }];
  return [];
}

function contextLine(item: McpInvocationContentItem): string {
  const role = item.role ? ` role=${item.role}` : "";
  if (item.text) return `[content${role}]\n${item.text}`;
  const name = item.name ? ` name=${JSON.stringify(item.name)}` : "";
  const mime = item.mimeType ? ` mime=${item.mimeType}` : "";
  const uri = item.uri ? ` uri=${item.uri}` : "";
  return `[${item.kind}${role}${name}${mime}${uri}]`;
}

export async function mapMcpInvocationContent(args: {
  ctx: ActionCtx;
  result: unknown;
  serverName: string;
  itemName: string;
  kind: "prompt" | "resource" | "resource_template";
}): Promise<{ contentItems: McpInvocationContentItem[]; contextText: string }> {
  const items: McpInvocationContentItem[] = [];
  try {
    for (const group of contentArrays(args.result)) {
      for (const value of group.values) {
        if (items.length >= MAX_ITEMS) break;
        items.push(...await mapOne(args.ctx, value, group.role));
      }
    }
  } catch (error) {
    await deleteMcpInvocationContent(args.ctx, items);
    throw error;
  }
  const header = `[Remote MCP ${args.kind}: ${args.serverName} · ${args.itemName}]`;
  const body = items.map(contextLine).join("\n\n");
  return {
    contentItems: items.slice(0, MAX_ITEMS),
    contextText: `${header}\n${body || "[No textual content returned.]"}`.slice(0, MAX_CONTEXT_CHARS),
  };
}
