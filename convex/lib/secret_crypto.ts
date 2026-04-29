import { ConvexError } from "convex/values";

const ENCRYPTED_PREFIX = "enc:v1:";
const KEY_ENV = "CONVEX_SECRET_ENCRYPTION_KEY";
const IV_BYTES = 12;
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

function base64UrlToBytes(value: string): Uint8Array {
  const outputLength = Math.floor((value.length * 6) / 8);
  const bytes = new Uint8Array(outputLength);
  let buffer = 0;
  let bits = 0;
  let byteIndex = 0;

  for (const character of value) {
    const next = BASE64URL_ALPHABET.indexOf(character);
    if (next < 0) throw new Error("Encrypted secret payload is invalid.");

    buffer = (buffer << 6) | next;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      bytes[byteIndex] = (buffer >> bits) & 255;
      byteIndex += 1;
    }
  }

  return bytes;
}

async function getKey(): Promise<CryptoKey | null> {
  const rawKey = process.env[KEY_ENV]?.trim();
  if (!rawKey) return null;

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(rawKey),
  );

  return await crypto.subtle.importKey(
    "raw",
    digest,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function maybeEncryptSecret(secret: string): Promise<string> {
  if (secret.startsWith(ENCRYPTED_PREFIX)) return secret;

  const key = await getKey();
  if (!key) return secret;

  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(secret),
  ));
  const payload = new Uint8Array(iv.length + ciphertext.length);
  payload.set(iv, 0);
  payload.set(ciphertext, iv.length);

  return `${ENCRYPTED_PREFIX}${bytesToBase64Url(payload)}`;
}

export async function encryptSecret(secret: string): Promise<string> {
  const encrypted = await maybeEncryptSecret(secret);
  if (!encrypted.startsWith(ENCRYPTED_PREFIX)) {
    throw new ConvexError({
      code: "SECRET_ENCRYPTION_NOT_CONFIGURED" as const,
      message: `${KEY_ENV} is required to store new app passwords.`,
    });
  }
  return encrypted;
}

export async function maybeDecryptSecret(secret: string): Promise<string> {
  if (!secret.startsWith(ENCRYPTED_PREFIX)) return secret;

  const key = await getKey();
  if (!key) {
    throw new Error(`${KEY_ENV} is required to decrypt stored secrets.`);
  }

  const payload = base64UrlToBytes(secret.slice(ENCRYPTED_PREFIX.length));
  if (payload.length <= IV_BYTES) {
    throw new Error("Encrypted secret payload is invalid.");
  }

  const iv = new Uint8Array(payload.slice(0, IV_BYTES));
  const ciphertext = new Uint8Array(payload.slice(IV_BYTES));
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );

  return new TextDecoder().decode(plaintext);
}
