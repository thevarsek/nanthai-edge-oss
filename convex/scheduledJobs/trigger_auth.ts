export const SCHEDULED_TRIGGER_TOKEN_PREFIX = "sk_sched_";

export function createScheduledTriggerToken(): {
  rawToken: string;
  tokenPrefix: string;
} {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const randomPart = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const rawToken = `${SCHEDULED_TRIGGER_TOKEN_PREFIX}${randomPart}`;
  const tokenPrefix = rawToken.slice(0, Math.min(16, rawToken.length));
  return { rawToken, tokenPrefix };
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function parseBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const [scheme, value] = authHeader.trim().split(/\s+/, 2);
  if (!scheme || !value || scheme.toLowerCase() !== "bearer") {
    return null;
  }
  return value;
}
