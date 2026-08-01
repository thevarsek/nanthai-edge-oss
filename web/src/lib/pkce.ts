/** OpenRouter PKCE helpers — browser-native implementation */

const ALLOWED_CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";

function randomString(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => ALLOWED_CHARS[b % ALLOWED_CHARS.length])
    .join("");
}

async function sha256Base64Url(plain: string): Promise<string> {
  const encoded = new TextEncoder().encode(plain);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = new Uint8Array(hash);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export interface PKCEParams {
  verifier: string;
  challenge: string;
  state: string;
}

export async function generatePKCE(): Promise<PKCEParams> {
  const verifier = randomString(64);
  const challenge = await sha256Base64Url(verifier);
  const state = randomString(64);
  return { verifier, challenge, state };
}

export function buildOpenRouterAuthUrl(
  challenge: string,
  state: string,
  callbackUrl: string,
): string {
  const params = new URLSearchParams({
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    callback_url: callbackUrl,
  });
  return `https://openrouter.ai/auth?${params.toString()}`;
}
