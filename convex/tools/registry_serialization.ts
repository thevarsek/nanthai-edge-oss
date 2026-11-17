import type { ToolResult } from "./registry_types";

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function serializeToolResult(result: ToolResult): string {
  const serialized = JSON.stringify(result);
  if (serialized.length <= 700_000) return serialized;
  return JSON.stringify({
    success: result.success,
    data: null,
    error: result.error,
    replayTruncated: true,
  });
}
