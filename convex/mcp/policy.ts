import { ConvexError } from "convex/values";

export const MCP_PROTOCOL_VERSION = "2026-07-28" as const;
export const MCP_MAX_CATALOG_ITEMS = 500;
export const MCP_MAX_TOOL_ITEMS = 128;
export const MCP_MAX_SCHEMA_BYTES = 64 * 1024;
export const MCP_MAX_SCHEMA_DEPTH = 24;
export const MCP_MAX_SCHEMA_NODES = 4_096;
// Leaves room for invocation metadata within Convex's document-size ceiling.
export const MCP_MAX_RESULT_BYTES = 256 * 1024;

export function serializeBoundedMcpResult(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (
    serialized === undefined
    || new TextEncoder().encode(serialized).byteLength > MCP_MAX_RESULT_BYTES
  ) {
    throw new Error("MCP_RESULT_TOO_LARGE");
  }
  return serialized;
}

const API_KEY_HEADER_PATTERN = /^x-[a-z0-9][a-z0-9-]{0,62}$/;
const RESERVED_HEADERS = new Set([
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-nanthai-egress-key",
  "mcp-method",
  "mcp-name",
  "mcp-protocol-version",
]);

function isObviousPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "::" || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe8")) {
    return true;
  }
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return true;
  const [first = 0, second = 0] = octets;
  return first === 0
    || first === 10
    || first === 127
    || first >= 224
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

export function safeMcpEndpoint(value: string): {
  endpoint: string;
  origin: string;
  host: string;
} {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ConvexError({
      code: "MCP_INVALID_URL" as const,
      message: "Enter a valid HTTPS Remote MCP server URL.",
    });
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.hash
    || (url.port && url.port !== "443")
    || url.hostname === "localhost"
    || url.hostname.endsWith(".localhost")
    || url.hostname.endsWith(".local")
    || url.hostname.endsWith(".internal")
    || isObviousPrivateHost(url.hostname)
  ) {
    throw new ConvexError({
      code: "MCP_UNSAFE_ENDPOINT" as const,
      message: "NanthAI supports public HTTPS Remote MCP server endpoints on the default port.",
    });
  }
  url.hostname = url.hostname.toLowerCase();
  return { endpoint: url.toString(), origin: url.origin, host: url.hostname };
}

export function safeApiKeyHeader(value: string): string {
  const header = value.trim().toLowerCase();
  if (!API_KEY_HEADER_PATTERN.test(header) || RESERVED_HEADERS.has(header)) {
    throw new ConvexError({
      code: "MCP_UNSAFE_HEADER" as const,
      message: "Use a custom X- API key header that does not override MCP routing headers.",
    });
  }
  return header;
}

export function boundedText(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : undefined;
}

export function isMcpAuthenticationError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    cause?: unknown;
  };
  return candidate.code === "CLIENT_HTTP_AUTHENTICATION"
    || candidate.status === 401
    || candidate.statusCode === 401
    || (candidate.cause !== error && isMcpAuthenticationError(candidate.cause));
}

export function unsupportedServerMessage(): string {
  return "NanthAI supports remote HTTPS MCP servers using the stateless MCP 2026-07-28 protocol. This server is using an older or unsupported setup. Ask its owner to update and deploy a compatible remote endpoint.";
}
