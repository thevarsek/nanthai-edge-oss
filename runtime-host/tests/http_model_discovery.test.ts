import assert from "node:assert/strict";
import test from "node:test";

import { canonicalCodexCapabilities } from "../src/canonical_capabilities.ts";
import { APP_SERVER_CAPABILITIES } from "../src/codex_capabilities.ts";
import { HttpRuntimeControlPlane } from "../src/http_runtime_transport.ts";

test("HTTP discovery lane uses the current authenticated presence contract", async () => {
  const requests: CapturedRequest[] = [];
  const fetchImplementation = captureFetch(requests, (request) => {
    switch (request.url.pathname) {
      case "/runtime-host/v1/presence/heartbeat":
        return json({ presenceId: "presence-1", serverTime: 1_000, expiresAt: 61_000 });
      case "/runtime-host/v1/model-discovery/poll":
        return json({ requests: [{
          requestId: "discovery-1", adapterId: "codex", expiresAt: 121_000,
        }], serverTime: 1_000 });
      case "/runtime-host/v1/model-discovery/complete":
      case "/runtime-host/v1/presence/disconnect":
        return json({ changed: true });
      default: throw new Error(`Unexpected request: ${request.url.pathname}`);
    }
  });
  const connection = await new HttpRuntimeControlPlane({
    fetch: fetchImplementation,
    createPresenceSessionId: () => "presence-session-1",
    delay: waitForAbort,
    now: () => 1_000,
    operatingSystemRelease: () => "25.6.0",
  }).connect({
    deviceId: "device-1", credentialId: "credential-1",
    controlPlaneUrl: "https://control.example.test/api", credential: "secret",
  }, registration());
  const iterator = connection.modelDiscoveryRequests()[Symbol.asyncIterator]();

  assert.deepEqual((await iterator.next()).value, {
    requestId: "discovery-1", adapterId: "codex", expiresAt: 121_000,
  });
  await connection.completeModelDiscovery({
    requestId: "discovery-1",
    status: "completed",
    models: [{
      provider: "openai", modelId: "gpt-test", displayName: "GPT Test",
      availability: "available", unavailableReason: null, inputModalities: ["text"],
      supportsTools: true, supportsReasoning: true,
    }],
  });
  const pendingPoll = iterator.next();
  await connection.close();
  assert.equal((await pendingPoll).done, true);

  const poll = requests.find((request) => request.url.pathname.endsWith("discovery/poll"));
  const completion = requests.find(
    (request) => request.url.pathname.endsWith("discovery/complete"),
  );
  assert.deepEqual(poll?.body, {});
  assert.deepEqual(completion?.body, {
    requestId: "discovery-1",
    status: "completed",
    models: [{
      provider: "openai", modelId: "gpt-test", displayName: "GPT Test",
      availability: "available", unavailableReason: null, inputModalities: ["text"],
      supportsTools: true, supportsReasoning: true,
    }],
  });
  for (const request of [poll, completion]) {
    assert.equal(request?.headers.get("Authorization"), "Bearer secret");
    assert.equal(request?.headers.get("X-NanthAI-Device-ID"), "device-1");
    assert.equal(request?.headers.get("X-NanthAI-Credential-ID"), "credential-1");
    assert.equal(request?.headers.get("X-NanthAI-Presence-Session-ID"), "presence-session-1");
  }
});

function registration() {
  const capabilities = canonicalCodexCapabilities(APP_SERVER_CAPABILITIES);
  return {
    deviceId: "device-1", owner: "foreground_cli" as const, hostVersion: "test",
    hostname: "Dino Mac", platform: "darwin" as const, architecture: "arm64",
    adapters: [{
      adapterId: "codex", adapterVersion: capabilities.adapterVersion,
      authState: "ready" as const, capabilities,
    }],
  };
}

type CapturedRequest = {
  url: URL;
  headers: Headers;
  body: Record<string, unknown> | null;
};

function captureFetch(
  requests: CapturedRequest[],
  respond: (request: CapturedRequest) => Response,
): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const text = await request.text();
    const captured = {
      url: new URL(request.url),
      headers: request.headers,
      body: text.length === 0 ? null : JSON.parse(text) as Record<string, unknown>,
    };
    requests.push(captured);
    return respond(captured);
  };
}

function json(value: unknown): Response {
  return Response.json(value);
}

async function waitForAbort(_milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}
