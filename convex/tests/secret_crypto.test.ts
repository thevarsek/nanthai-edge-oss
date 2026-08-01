import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptSecret,
  encryptSecret,
  oauthSecretContext,
  parseSecretEnvelope,
  userApiKeySecretContext,
  mcpCredentialSecretContext,
  mcpOAuthTransactionSecretContext,
} from "../lib/secret_crypto";

const ENV_NAMES = [
  "CONVEX_SECRET_ENCRYPTION_KEY",
  "CONVEX_SECRET_ENCRYPTION_KEY_K2",
  "CONVEX_SECRET_ENCRYPTION_ACTIVE_KID",
  "CONVEX_SECRET_LEGACY_READ_MODE",
] as const;

async function withCryptoEnv(run: () => Promise<void>): Promise<void> {
  const original = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
  process.env.CONVEX_SECRET_ENCRYPTION_KEY = "test-k1-material";
  process.env.CONVEX_SECRET_ENCRYPTION_KEY_K2 = "test-k2-material";
  process.env.CONVEX_SECRET_ENCRYPTION_ACTIVE_KID = "k2";
  process.env.CONVEX_SECRET_LEGACY_READ_MODE = "migrate";
  try {
    await run();
  } finally {
    for (const name of ENV_NAMES) {
      const value = original[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function legacyV1(secret: string): Promise<string> {
  const keyMaterial = new TextEncoder().encode("test-k1-material");
  const digest = await crypto.subtle.digest("SHA-256", keyMaterial);
  const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = new Uint8Array(12).fill(7);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(secret),
  ));
  return `enc:v1:${Buffer.concat([Buffer.from(iv), Buffer.from(ciphertext)]).toString("base64url")}`;
}

test("v2 uses fresh nonces and contextual authenticated data", async () => {
  await withCryptoEnv(async () => {
    const context = oauthSecretContext("user_1", "google", "accessToken");
    const first = await encryptSecret("access-secret", context);
    const second = await encryptSecret("access-secret", context);
    assert.notEqual(first, second);
    assert.equal(parseSecretEnvelope(first)?.keyId, "k2");
    assert.equal(await decryptSecret(first, context), "access-secret");
    await assert.rejects(decryptSecret(first, oauthSecretContext("user_2", "google", "accessToken")));
    await assert.rejects(decryptSecret(first, oauthSecretContext("user_1", "microsoft", "accessToken")));
    await assert.rejects(decryptSecret(first, oauthSecretContext("user_1", "google", "refreshToken")));
  });
});

test("migration mode reads plaintext and v1 while disabled mode fails closed", async () => {
  await withCryptoEnv(async () => {
    const context = userApiKeySecretContext("user_1");
    assert.equal(await decryptSecret("legacy-plaintext", context), "legacy-plaintext");
    assert.equal(await decryptSecret(await legacyV1("legacy-v1"), context), "legacy-v1");
    process.env.CONVEX_SECRET_LEGACY_READ_MODE = "disabled";
    await assert.rejects(decryptSecret("legacy-plaintext", context));
    await assert.rejects(decryptSecret(await legacyV1("legacy-v1"), context));
  });
});

test("malformed envelopes, missing keys, and unknown key ids fail closed", async () => {
  await withCryptoEnv(async () => {
    const context = userApiKeySecretContext("user_1");
    await assert.rejects(decryptSecret("enc:v2:k2:bad:bad", context));
    await assert.rejects(decryptSecret("enc:v2:k99:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA", context));
    delete process.env.CONVEX_SECRET_ENCRYPTION_KEY_K2;
    await assert.rejects(encryptSecret("secret", context));
  });
});

test("MCP credential AAD binds owner, connection, issuer, and credential kind", async () => {
  await withCryptoEnv(async () => {
    const context = mcpCredentialSecretContext({
      userId: "user_1",
      connectionId: "connection_1",
      issuerOrOrigin: "https://auth.example.com",
      field: "accessToken",
    });
    const envelope = await encryptSecret("mcp-access", context);
    assert.equal(await decryptSecret(envelope, context), "mcp-access");
    await assert.rejects(decryptSecret(envelope, mcpCredentialSecretContext({
      userId: "user_2",
      connectionId: "connection_1",
      issuerOrOrigin: "https://auth.example.com",
      field: "accessToken",
    })));
    await assert.rejects(decryptSecret(envelope, mcpCredentialSecretContext({
      userId: "user_1",
      connectionId: "connection_2",
      issuerOrOrigin: "https://auth.example.com",
      field: "accessToken",
    })));
    await assert.rejects(decryptSecret(envelope, mcpCredentialSecretContext({
      userId: "user_1",
      connectionId: "connection_1",
      issuerOrOrigin: "https://other.example.com",
      field: "accessToken",
    })));
  });
});

test("MCP OAuth transaction AAD also binds the hash-only transaction identity", async () => {
  await withCryptoEnv(async () => {
    const context = mcpOAuthTransactionSecretContext({
      userId: "user_1",
      connectionId: "connection_1",
      issuerOrOrigin: "https://auth.example.com",
      transactionId: "state-hash-1",
      field: "pkceVerifier",
    });
    const envelope = await encryptSecret("pkce-verifier", context);
    assert.equal(await decryptSecret(envelope, context), "pkce-verifier");
    await assert.rejects(decryptSecret(envelope, mcpOAuthTransactionSecretContext({
      userId: "user_1",
      connectionId: "connection_1",
      issuerOrOrigin: "https://auth.example.com",
      transactionId: "state-hash-2",
      field: "pkceVerifier",
    })));
  });
});
