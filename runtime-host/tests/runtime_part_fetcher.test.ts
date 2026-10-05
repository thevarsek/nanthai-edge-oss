import assert from "node:assert/strict";
import test from "node:test";

import type { DeviceCredential } from "../src/control_plane.ts";
import { HttpRuntimePartFetcher } from "../src/runtime_part_fetcher.ts";

const SHA256 = "a".repeat(64);
const EXPIRES_AT = 1_786_752_060_000;

test("fetches an authorized immutable chunk with all host credentials", async () => {
  const bytes = Buffer.from("png");
  let calls = 0;
  const fetcher = new HttpRuntimePartFetcher(credential(), {
    presenceSessionId: "presence-1",
    fetch: async (input, init) => {
      calls += 1;
      assert.equal(new URL(input instanceof Request ? input.url : input).pathname,
        "/runtime-host/v1/attachments/fetch");
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        handle: "opaque-handle", offset: 3, maxBytes: 3,
      });
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("Authorization"), "Bearer device-secret");
      assert.equal(headers.get("X-NanthAI-Device-ID"), "device-1");
      assert.equal(headers.get("X-NanthAI-Credential-ID"), "credential-1");
      assert.equal(headers.get("X-NanthAI-Presence-Session-ID"), "presence-1");
      return chunkResponse(bytes, 3, 9);
    },
  });
  const result = await fetcher.fetchChunk({
    fetch: fetchHandle(), mimeType: "image/png", offset: 3, maxBytes: 3,
  }, new AbortController().signal);
  assert.deepEqual(Buffer.from(result), bytes);
  assert.equal(calls, 1);
});

test("rejects response metadata that differs from the canonical handle", async () => {
  const fetcher = new HttpRuntimePartFetcher(credential(), {
    presenceSessionId: "presence-1",
    fetch: async () => {
      const response = chunkResponse(Buffer.from("png"), 0, 9);
      response.headers.set("X-NanthAI-Attachment-SHA256", "b".repeat(64));
      return response;
    },
  });
  await assert.rejects(fetcher.fetchChunk({
    fetch: fetchHandle(), mimeType: "image/png", offset: 0, maxBytes: 3,
  }, new AbortController().signal), /SHA-256/);
});

function chunkResponse(bytes: Uint8Array, offset: number, total: number): Response {
  const end = offset + bytes.byteLength - 1;
  return new Response(Buffer.from(bytes), {
    status: 206,
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(bytes.byteLength),
      "Content-Range": `bytes ${offset}-${end}/${total}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      ETag: `"${SHA256}"`,
      "X-NanthAI-Attachment-Offset": String(offset),
      "X-NanthAI-Attachment-Byte-Length": String(total),
      "X-NanthAI-Attachment-SHA256": SHA256,
      "X-NanthAI-Attachment-Expires-At": String(EXPIRES_AT),
    },
  });
}

function credential(): DeviceCredential {
  return {
    deviceId: "device-1",
    credentialId: "credential-1",
    controlPlaneUrl: "https://runtime.example.test",
    credential: "device-secret",
  };
}

function fetchHandle() {
  return {
    handle: "opaque-handle",
    expiresAt: EXPIRES_AT,
    byteLength: 9,
    maxChunkBytes: 3,
    sha256: SHA256,
  };
}
