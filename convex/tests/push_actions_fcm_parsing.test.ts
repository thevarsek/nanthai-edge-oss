import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import {
  extractFcmV1ErrorCode,
  extractFcmV1ErrorMessage,
  fetchFcmAccessToken,
  parseFcmResponseBody,
  resolveFcmHttpV1Config,
} from "../push/fcm_http_v1";

test("resolveFcmHttpV1Config returns null when any required env var is missing", () => {
  assert.equal(resolveFcmHttpV1Config({}), null);
  assert.equal(
    resolveFcmHttpV1Config({
      FCM_PROJECT_ID: "nanthai-edge",
      FCM_CLIENT_EMAIL: "svc@example.com",
    }),
    null,
  );
});

test("resolveFcmHttpV1Config trims required env vars", () => {
  assert.deepEqual(
    resolveFcmHttpV1Config({
      FCM_PROJECT_ID: " nanthai-edge ",
      FCM_CLIENT_EMAIL: " svc@example.com ",
      FCM_PRIVATE_KEY: " key ",
    }),
    {
      projectId: "nanthai-edge",
      clientEmail: "svc@example.com",
      privateKey: "key",
    },
  );
});

test("parseFcmResponseBody parses valid JSON and returns null for invalid JSON", () => {
  assert.deepEqual(parseFcmResponseBody('{"ok":true}'), { ok: true });
  assert.equal(parseFcmResponseBody("not-json"), null);
});

test("extractFcmV1ErrorCode and extractFcmV1ErrorMessage read structured v1 errors", () => {
  const body = {
    error: {
      message: "Requested entity was not found.",
      details: [
        {
          "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
          errorCode: "UNREGISTERED",
        },
      ],
    },
  };

  assert.equal(extractFcmV1ErrorCode(body), "UNREGISTERED");
  assert.equal(extractFcmV1ErrorMessage(body), "Requested entity was not found.");
});

test("extractFcmV1ErrorCode returns null for malformed response bodies", () => {
  assert.equal(extractFcmV1ErrorCode(null), null);
  assert.equal(extractFcmV1ErrorCode({}), null);
  assert.equal(extractFcmV1ErrorCode({ error: { details: [] } }), null);
  assert.equal(
    extractFcmV1ErrorCode({ error: { details: [{ errorCode: 42 }] } }),
    null,
  );
});

test("fetchFcmAccessToken posts a JWT bearer request and returns the access token", async () => {
  const originalFetch = globalThis.fetch;
  const seenRequests: Array<{ url: string; init?: RequestInit }> = [];
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: {
      format: "pem",
      type: "pkcs8",
    },
    publicKeyEncoding: {
      format: "pem",
      type: "spki",
    },
  });

  try {
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      seenRequests.push({ url: String(url), init });
      return {
        ok: true,
        text: async () => JSON.stringify({ access_token: "token_123" }),
      } as Response;
    }) as typeof fetch;

    const accessToken = await fetchFcmAccessToken({
      projectId: "nanthai-edge",
      clientEmail: "firebase-adminsdk@nanthai-edge.iam.gserviceaccount.com",
      privateKey,
    });

    assert.equal(accessToken, "token_123");
    assert.equal(seenRequests.length, 1);
    assert.equal(seenRequests[0]?.url, "https://oauth2.googleapis.com/token");
    assert.equal(seenRequests[0]?.init?.method, "POST");
    assert.match(
      String(seenRequests[0]?.init?.headers && (seenRequests[0]?.init?.headers as Record<string, string>)["content-type"]),
      /application\/x-www-form-urlencoded/,
    );
    const body = String(seenRequests[0]?.init?.body);
    assert.match(body, /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer/);
    assert.match(body, /assertion=/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
