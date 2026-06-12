const ANALYTICS_ID_SECRET_ENV = "ANALYTICS_ID_SECRET";
const ANALYTICS_ID_PREFIX = "aid_";
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function bytesToBase64Url(bytes: Uint8Array): string {
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const byte1 = bytes[index] ?? 0;
    const byte2 = bytes[index + 1] ?? 0;
    const byte3 = bytes[index + 2] ?? 0;
    const chunk = (byte1 << 16) | (byte2 << 8) | byte3;

    result += BASE64URL_ALPHABET[(chunk >> 18) & 63];
    result += BASE64URL_ALPHABET[(chunk >> 12) & 63];
    if (index + 1 < bytes.length) result += BASE64URL_ALPHABET[(chunk >> 6) & 63];
    if (index + 2 < bytes.length) result += BASE64URL_ALPHABET[chunk & 63];
  }
  return result;
}

function analyticsSecret(): string | null {
  const secret = process.env[ANALYTICS_ID_SECRET_ENV]?.trim();
  return secret && secret.length > 0 ? secret : null;
}

async function hmacSha256Base64Url(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
  );
  return bytesToBase64Url(signature);
}

export async function deriveAnalyticsIdForClerkUserId(
  clerkUserId: string,
): Promise<string | null> {
  const secret = analyticsSecret();
  const normalizedUserId = clerkUserId.trim();
  if (!secret || !normalizedUserId) return null;

  const digest = await hmacSha256Base64Url(secret, normalizedUserId);
  return `${ANALYTICS_ID_PREFIX}${digest}`;
}
