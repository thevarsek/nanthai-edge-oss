import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { signAPNsJWT } from "../push/apns_jwt";

function decodeBase64Url(segment: string): string {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

test("signAPNsJWT builds a compact JWT with base64url-safe segments", async (t) => {
  t.after(() => {
    mock.restoreAll();
  });

  const importedKey = {} as CryptoKey;
  const derSignature = Uint8Array.from([
    0x30, 0x46,
    0x02, 0x21, 0x00,
    ...Array.from({ length: 32 }, (_, i) => i + 1),
    0x02, 0x21, 0x00,
    ...Array.from({ length: 32 }, (_, i) => 65 - i),
  ]);

  mock.method(globalThis.crypto.subtle, "importKey", async () => importedKey);
  mock.method(globalThis.crypto.subtle, "sign", async () => derSignature.buffer);

  const token = await signAPNsJWT(
    "kid123",
    "team456",
    "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----",
  );

  const segments = token.split(".");
  assert.equal(segments.length, 3);
  assert.match(segments[0] ?? "", /^[A-Za-z0-9_-]+$/);
  assert.match(segments[1] ?? "", /^[A-Za-z0-9_-]+$/);
  assert.match(segments[2] ?? "", /^[A-Za-z0-9_-]+$/);

  assert.deepEqual(JSON.parse(decodeBase64Url(segments[0] ?? "")), {
    alg: "ES256",
    kid: "kid123",
  });

  const claims = JSON.parse(decodeBase64Url(segments[1] ?? ""));
  assert.equal(claims.iss, "team456");
  assert.equal(typeof claims.iat, "number");

  const signature = Buffer.from(
    (segments[2] ?? "").replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  );
  assert.equal(signature.length, 64);
});

test("signAPNsJWT preserves already-raw signatures without DER conversion", async (t) => {
  t.after(() => {
    mock.restoreAll();
  });

  const importedKey = {} as CryptoKey;
  const rawSignature = Uint8Array.from({ length: 64 }, (_, i) => i);

  mock.method(globalThis.crypto.subtle, "importKey", async () => importedKey);
  mock.method(globalThis.crypto.subtle, "sign", async () => rawSignature.buffer);

  const token = await signAPNsJWT(
    "kid123",
    "team456",
    "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----",
  );

  const [, , signatureSegment] = token.split(".");
  const signature = Buffer.from(
    (signatureSegment ?? "").replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  );
  assert.deepEqual(signature, Buffer.from(rawSignature));
});
