"use node";

import { createHash } from "node:crypto";
import { UriTemplate } from "@modelcontextprotocol/client";
import {
  boundedText,
  MCP_MAX_SCHEMA_BYTES,
  MCP_MAX_SCHEMA_DEPTH,
  MCP_MAX_SCHEMA_NODES,
} from "./policy";

type CatalogKind = "tool" | "prompt" | "resource" | "resource_template";

type McpResourceTemplate = {
  name: string;
  uriTemplate: string;
  title?: string;
  description?: string;
  mimeType?: string;
  _meta?: unknown;
};

export function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function stableCatalogKey(kind: CatalogKind, identifier: string): string {
  const candidate = `${kind}:${identifier}`;
  if (candidate.length <= 512) return candidate;
  return `${candidate.slice(0, 447)}:${hashJson(candidate)}`;
}

function exceedsJsonComplexity(value: unknown): boolean {
  let nodes = 0;
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    nodes += 1;
    if (nodes > MCP_MAX_SCHEMA_NODES || current.depth > MCP_MAX_SCHEMA_DEPTH) return true;
    if (Array.isArray(current.value)) {
      for (const child of current.value) pending.push({ value: child, depth: current.depth + 1 });
    } else if (typeof current.value === "object" && current.value !== null) {
      for (const child of Object.values(current.value)) {
        pending.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
  return false;
}

export function boundedCatalogJson(value: unknown): { value?: unknown; tooLarge: boolean } {
  if (value === undefined) return { tooLarge: false };
  if (exceedsJsonComplexity(value)) return { tooLarge: true };
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return { tooLarge: false };
  if (serialized.length > MCP_MAX_SCHEMA_BYTES) return { tooLarge: true };
  return { value: JSON.parse(serialized) as unknown, tooLarge: false };
}

export function normalizeResourceTemplate(template: McpResourceTemplate) {
  const title = boundedText(template.title, 256);
  const description = boundedText(template.description, 2000);
  const metadata = boundedCatalogJson(template._meta).value;
  const uriTemplate = template.uriTemplate.slice(0, 2048);
  let templateArguments: Array<{
    name: string;
    title: string;
    required: true;
  }> = [];
  let invalidTemplate = false;
  try {
    templateArguments = new UriTemplate(uriTemplate).variableNames.map((name) => ({
      name,
      title: name,
      required: true,
    }));
  } catch {
    invalidTemplate = true;
  }
  return {
    kind: "resource_template" as const,
    remoteName: template.name.slice(0, 256),
    stableKey: stableCatalogKey("resource_template", template.uriTemplate),
    title,
    description,
    uriTemplate,
    mimeType: boundedText(template.mimeType, 256),
    arguments: templateArguments,
    metadata,
    definitionHash: hashJson({
      kind: "resource_template",
      name: template.name,
      title,
      description,
      uriTemplate: template.uriTemplate,
      mimeType: template.mimeType,
      arguments: templateArguments,
      metadata,
    }),
    disabledReason: invalidTemplate || template.uriTemplate.length > 2048
      ? "INVALID_URI_TEMPLATE"
      : undefined,
  };
}
