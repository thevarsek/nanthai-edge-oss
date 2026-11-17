// Stable per-user UUID that binds App Store (`appAccountToken`) and Google Play
// (`obfuscatedExternalAccountId`) purchases to the NanthAI account that made
// them. Derived on the server, so it needs no stored state and is identical for
// every client of the same account.

const NAMESPACE = "nanthai-store-account-v1:";

export async function storeAccountTokenForUser(userId: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${NAMESPACE}${userId}`),
  ));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // RFC 4122 name-based version nibble.
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant.
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A store transaction that carries an account token must match the claiming
 * user's token. Purchases made before binding carry none and remain valid.
 */
export function storeAccountTokenMatches(transactionToken: unknown, expectedToken: string): boolean {
  if (transactionToken === undefined || transactionToken === null || transactionToken === "") return true;
  return typeof transactionToken === "string"
    && transactionToken.trim().toLowerCase() === expectedToken.toLowerCase();
}
