import { ConvexError } from "convex/values";
const LEGACY_PREFIX = "enc:v1:";
const ENVELOPE_PREFIX = "enc:v2:";
const LEGACY_KEY_ENV = "CONVEX_SECRET_ENCRYPTION_KEY";
const ACTIVE_KID_ENV = "CONVEX_SECRET_ENCRYPTION_ACTIVE_KID";
const LEGACY_READ_MODE_ENV = "CONVEX_SECRET_LEGACY_READ_MODE";
const IV_BYTES = 12;
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const KEY_ID_PATTERN = /^k[1-9][0-9]*$/;

export type SecretField =
  | "accessToken"
  | "refreshToken"
  | "apiKey"
  | "credentialValue"
  | "clientSecret"
  | "pkceVerifier";

export type SecretContext =
  | {
    namespace: "oauthConnections";
    userId: string;
    provider: string;
    field: "accessToken" | "refreshToken";
  }
  | {
    namespace: "userSecrets";
    userId: string;
    field: "apiKey";
  }
  | {
    namespace: "mcpCredentials";
    userId: string;
    connectionId: string;
    issuerOrOrigin: string;
    field: "accessToken" | "refreshToken" | "credentialValue" | "clientSecret";
  }
  | {
    namespace: "mcpOAuthTransactions";
    userId: string;
    connectionId: string;
    issuerOrOrigin: string;
    transactionId: string;
    field: "pkceVerifier" | "clientSecret";
  };

export interface SecretEnvelopeMetadata {
  envelopeVersion: 2;
  keyId: string;
}
type NonceSource = () => Uint8Array;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

function credentialUnavailable(): ConvexError<{
  code: "CREDENTIAL_UNAVAILABLE";
  message: string;
}> {
  return new ConvexError({
    code: "CREDENTIAL_UNAVAILABLE" as const,
    message: "The stored credential is unavailable. Reconnect this integration.",
  });
}

function encryptionUnavailable(): ConvexError<{
  code: "SECRET_ENCRYPTION_NOT_CONFIGURED";
  message: string;
}> {
  return new ConvexError({
    code: "SECRET_ENCRYPTION_NOT_CONFIGURED" as const,
    message: "Credential encryption is not configured.",
  });
}

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
  if (!value) throw credentialUnavailable();
  if (value.length % 4 === 1) throw credentialUnavailable();
  const outputLength = Math.floor((value.length * 6) / 8);
  const bytes = new Uint8Array(outputLength);
  let buffer = 0;
  let bits = 0;
  let byteIndex = 0;

  for (const character of value) {
    const next = BASE64URL_ALPHABET.indexOf(character);
    if (next < 0) throw credentialUnavailable();
    buffer = (buffer << 6) | next;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[byteIndex] = (buffer >> bits) & 255;
      byteIndex += 1;
    }
  }
  if (bytesToBase64Url(bytes) !== value) throw credentialUnavailable();
  return bytes;
}

function activeKeyId(): string {
  const keyId = process.env[ACTIVE_KID_ENV]?.trim() || "k1";
  if (!KEY_ID_PATTERN.test(keyId)) throw encryptionUnavailable();
  return keyId;
}

function keyMaterial(keyId: string): string | null {
  if (!KEY_ID_PATTERN.test(keyId)) return null;
  const environmentName = keyId === "k1"
    ? LEGACY_KEY_ENV
    : `CONVEX_SECRET_ENCRYPTION_KEY_${keyId.toUpperCase()}`;
  return process.env[environmentName]?.trim() || null;
}

async function importKey(keyId: string): Promise<CryptoKey> {
  const rawKey = keyMaterial(keyId);
  if (!rawKey) throw encryptionUnavailable();
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

function associatedData(context: SecretContext): Uint8Array {
  if (!context.userId.trim()) throw credentialUnavailable();
  let parts: string[];
  if (context.namespace === "oauthConnections") {
    if (!context.provider.trim()) throw credentialUnavailable();
    parts = ["nanthai", context.namespace, context.userId, context.provider, context.field];
  } else if (context.namespace === "userSecrets") {
    parts = ["nanthai", context.namespace, context.userId, context.field];
  } else if (context.namespace === "mcpCredentials") {
    if (!context.connectionId.trim() || !context.issuerOrOrigin.trim()) {
      throw credentialUnavailable();
    }
    parts = [
      "nanthai",
      context.namespace,
      context.userId,
      context.connectionId,
      context.issuerOrOrigin,
      context.field,
    ];
  } else {
    if (
      !context.connectionId.trim()
      || !context.issuerOrOrigin.trim()
      || !context.transactionId.trim()
    ) {
      throw credentialUnavailable();
    }
    parts = [
      "nanthai",
      context.namespace,
      context.userId,
      context.connectionId,
      context.issuerOrOrigin,
      context.transactionId,
      context.field,
    ];
  }
  return new TextEncoder().encode(parts.join("|"));
}

function secureNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(IV_BYTES));
}

export function mutationSafeNonce(): Uint8Array {
  const nonce = new Uint8Array(IV_BYTES);
  for (let index = 0; index < nonce.length; index += 1) {
    nonce[index] = Math.floor(Math.random() * 256);
  }
  return nonce;
}

export function oauthSecretContext(
  userId: string,
  provider: string,
  field: "accessToken" | "refreshToken",
): SecretContext {
  return { namespace: "oauthConnections", userId, provider, field };
}

export function userApiKeySecretContext(userId: string): SecretContext {
  return { namespace: "userSecrets", userId, field: "apiKey" };
}

export function mcpCredentialSecretContext(args: {
  userId: string;
  connectionId: string;
  issuerOrOrigin: string;
  field: "accessToken" | "refreshToken" | "credentialValue" | "clientSecret";
}): SecretContext {
  return { namespace: "mcpCredentials", ...args };
}

export function mcpOAuthTransactionSecretContext(args: {
  userId: string;
  connectionId: string;
  issuerOrOrigin: string;
  transactionId: string;
  field: "pkceVerifier" | "clientSecret";
}): SecretContext {
  return { namespace: "mcpOAuthTransactions", ...args };
}
export function parseSecretEnvelope(value: string): SecretEnvelopeMetadata | null {
  if (!value.startsWith(ENVELOPE_PREFIX)) return null;
  const [keyId, iv, ciphertext, ...extra] = value.slice(ENVELOPE_PREFIX.length).split(":");
  if (!keyId || !KEY_ID_PATTERN.test(keyId) || !iv || !ciphertext || extra.length > 0) {
    throw credentialUnavailable();
  }
  if (base64UrlToBytes(iv).length !== IV_BYTES || base64UrlToBytes(ciphertext).length <= 16) {
    throw credentialUnavailable();
  }
  return { envelopeVersion: 2, keyId };
}

export function assertEncryptedSecret(value: string, allowEmpty = false): void {
  if (allowEmpty && value === "") return;
  if (!parseSecretEnvelope(value)) throw encryptionUnavailable();
}

export async function encryptSecret(
  secret: string,
  context: SecretContext,
  nonceSource: NonceSource = secureNonce,
  requestedKeyId?: string,
): Promise<string> {
  if (!secret) throw encryptionUnavailable();
  const keyId = requestedKeyId ?? activeKeyId();
  if (!KEY_ID_PATTERN.test(keyId)) throw encryptionUnavailable();
  const key = await importKey(keyId);
  const iv = nonceSource();
  if (iv.length !== IV_BYTES) throw encryptionUnavailable();
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(associatedData(context)),
    },
    key,
    new TextEncoder().encode(secret),
  ));
  return `${ENVELOPE_PREFIX}${keyId}:${bytesToBase64Url(iv)}:${bytesToBase64Url(ciphertext)}`;
}

async function decryptLegacyV1(value: string): Promise<string> {
  const key = await importKey("k1");
  const payload = base64UrlToBytes(value.slice(LEGACY_PREFIX.length));
  if (payload.length <= IV_BYTES) throw credentialUnavailable();
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: payload.slice(0, IV_BYTES) },
      key,
      payload.slice(IV_BYTES),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw credentialUnavailable();
  }
}

export async function decryptSecret(
  value: string,
  context: SecretContext,
): Promise<string> {
  if (value === "") return "";
  const metadata = parseSecretEnvelope(value);
  if (metadata) {
    const [, , , ivValue, ciphertextValue] = value.split(":");
    const iv = base64UrlToBytes(ivValue ?? "");
    const ciphertext = base64UrlToBytes(ciphertextValue ?? "");
    if (iv.length !== IV_BYTES || ciphertext.length <= 16) throw credentialUnavailable();
    try {
      const key = await importKey(metadata.keyId);
      const plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: toArrayBuffer(iv),
          additionalData: toArrayBuffer(associatedData(context)),
        },
        key,
        toArrayBuffer(ciphertext),
      );
      return new TextDecoder().decode(plaintext);
    } catch {
      throw credentialUnavailable();
    }
  }

  if ((process.env[LEGACY_READ_MODE_ENV]?.trim() || "migrate") !== "migrate") {
    throw credentialUnavailable();
  }
  if (value.startsWith(LEGACY_PREFIX)) return await decryptLegacyV1(value);
  return value;
}

export async function encryptOAuthCredentials(args: {
  userId: string;
  provider: string;
  accessToken: string;
  refreshToken: string;
  nonceSource?: NonceSource;
  keyId?: string;
}): Promise<{
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  secretEnvelopeVersion: 2;
  secretKeyId: string;
}> {
  const keyId = args.keyId ?? activeKeyId();
  const encryptedAccessToken = await encryptSecret(
    args.accessToken,
    oauthSecretContext(args.userId, args.provider, "accessToken"),
    args.nonceSource,
    keyId,
  );
  const encryptedRefreshToken = args.refreshToken
    ? await encryptSecret(
      args.refreshToken,
      oauthSecretContext(args.userId, args.provider, "refreshToken"),
      args.nonceSource,
      keyId,
    )
    : "";
  return {
    encryptedAccessToken,
    encryptedRefreshToken,
    secretEnvelopeVersion: 2,
    secretKeyId: keyId,
  };
}

export async function decryptOAuthCredentials(args: {
  userId: string;
  provider: string;
  accessToken: string;
  refreshToken: string;
}): Promise<{ accessToken: string; refreshToken: string }> {
  return {
    accessToken: await decryptSecret(
      args.accessToken,
      oauthSecretContext(args.userId, args.provider, "accessToken"),
    ),
    refreshToken: await decryptSecret(
      args.refreshToken,
      oauthSecretContext(args.userId, args.provider, "refreshToken"),
    ),
  };
}
