import assert from "node:assert/strict";
import test from "node:test";
import {
  downloadVideoContent,
  pollVideoJobStatus,
  submitVideoJob,
} from "../lib/openrouter_video";

test("video polling ignores provider-controlled destinations and sends auth only to OpenRouter", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; authorization: string | null; redirect?: RequestRedirect }> = [];
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    requests.push({
      url: String(input),
      authorization: headers.get("authorization"),
      redirect: init?.redirect,
    });
    return new Response(JSON.stringify({
      id: "job/with spaces",
      status: "completed",
      polling_url: "https://evil.example/steal",
      unsigned_urls: ["https://evil.example/video"],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await pollVideoJobStatus("secret-key", "job/with spaces");
    assert.equal(requests[0]?.url, "https://openrouter.ai/api/v1/videos/job%2Fwith%20spaces");
    assert.equal(requests[0]?.authorization, "Bearer secret-key");
    assert.equal(requests[0]?.redirect, "manual");
    assert.equal("polling_url" in result, false);
    assert.equal("unsigned_urls" in result, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("video submission discards provider-controlled polling URLs", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: "job_1",
    status: "pending",
    polling_url: "https://evil.example/steal",
  }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const result = await submitVideoJob("secret-key", { model: "video/model", prompt: "test" });
    assert.deepEqual(result, { id: "job_1", status: "pending" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("video polling normalizes current string and legacy object errors", async () => {
  const originalFetch = globalThis.fetch;
  const payloads = [
    { id: "job_1", status: "failed", error: "Provider rejected the prompt" },
    { id: "job_1", status: "failed", error: { code: "policy", message: "Legacy failure" } },
  ];
  try {
    globalThis.fetch = async () => new Response(JSON.stringify(payloads.shift()), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const current = await pollVideoJobStatus("secret-key", "job_1");
    const legacy = await pollVideoJobStatus("secret-key", "job_1");
    assert.deepEqual(current.error, { message: "Provider rejected the prompt" });
    assert.deepEqual(legacy.error, { code: "policy", message: "Legacy failure" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("video content rejects redirects and declared oversized responses", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(null, {
      status: 302,
      headers: { location: "https://evil.example/video" },
    });
    await assert.rejects(downloadVideoContent("secret-key", "job_1"), /HTTP 302/);

    globalThis.fetch = async () => new Response(new Uint8Array([1]), {
      status: 200,
      headers: {
        "content-type": "video/mp4",
        "content-length": String(512 * 1024 * 1024 + 1),
      },
    });
    await assert.rejects(downloadVideoContent("secret-key", "job_1"), /exceeds/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
