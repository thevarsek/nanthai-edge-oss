import assert from "node:assert/strict";
import test from "node:test";

import { canonicalCodexCapabilities } from "../src/canonical_capabilities.ts";
import { APP_SERVER_CAPABILITIES } from "../src/codex_capabilities.ts";
import type { RuntimeEvent } from "../src/control_plane.ts";
import { HttpPairingClient } from "../src/http_pairing_client.ts";
import { HttpRuntimeControlPlane } from "../src/http_runtime_transport.ts";
import type { ClaimedCommandPayload } from "../src/http_runtime_contract.ts";
import { runtimePacket } from "./fixtures/runtime_packet.ts";

const controlPlaneUrl = "https://control.example.test/api";
const credential = {
  deviceId: "device-1",
  credentialId: "credential-1",
  controlPlaneUrl,
  credential: "opaque-secret",
};

test("HTTP pairing command selects the explicit server on a fresh install", async () => {
  const requests: CapturedRequest[] = [];
  const client = new HttpPairingClient({ controlPlaneUrl: "", hostVersion: "0.2.0",
    fetch: captureFetch(requests, () => json({ protocolVersion: "nanthai.runtime.pairing.v1", pairingId: "qa", deviceId: "device-1", credentialId: "credential-1", credential: "opaque-secret", issuedAt: 2000 })) });
  const result = await client.pair({ pairingId: "qa", oneTimeCode: "123456", hostname: "QA Mac", platform: "darwin", architecture: "arm64", controlPlaneUrl });
  assert.equal(result.controlPlaneUrl, controlPlaneUrl);
  assert.equal(requests[0]?.url.origin, "https://control.example.test");
  await assert.rejects(client.pair({ pairingId: "qa", oneTimeCode: "123456", hostname: "QA Mac", platform: "darwin", architecture: "arm64" }), /--server/);
  assert.equal(requests.length, 1);
});

test("HTTP short-code pairing claims the canonical device grant without an ID lookup", async () => {
  const requests: CapturedRequest[] = [];
  const client = new HttpPairingClient({ controlPlaneUrl, hostVersion: "0.3.0",
    fetch: captureFetch(requests, () => json({ protocolVersion: "nanthai.runtime.pairing.v1", pairingId: "pairing_qa", deviceId: "device-1", credentialId: "credential-1", credential: "opaque-secret", issuedAt: 2000 })) });
  const result = await client.pair({ shortCode: true, oneTimeCode: "0123-4567-89AB-CDEF", hostname: "QA Mac", platform: "darwin", architecture: "arm64" });
  assert.equal(result.deviceId, "device-1");
  assert.equal(requests[0]?.url.pathname, "/runtime-host/v1/pairing/claim-code");
  assert.equal(requests[0]?.body?.shortCode, "0123-4567-89AB-CDEF");
  assert.equal(requests[0]?.body?.pairingId, undefined);
});

test("HTTP pairing claim sends the frozen v1 identity and returns opaque credentials", async () => {
  const requests: CapturedRequest[] = [];
  const client = new HttpPairingClient({
    controlPlaneUrl,
    hostVersion: "0.1.0",
    fetch: captureFetch(requests, () => json({
      protocolVersion: "nanthai.runtime.pairing.v1",
      pairingId: "pairing-1",
      deviceId: "device-1",
      credentialId: "credential-1",
      credential: "opaque-secret",
      issuedAt: 1_786_752_000_000,
    })),
    operatingSystemRelease: () => "25.6.0",
    createIdentity: () => ({ hostNonce: "nonce-1", hostPublicKey: "public-key-1" }),
  });
  const result = await client.pair({
    pairingId: "pairing-1",
    oneTimeCode: "one-time-code",
    hostname: "Dino Mac",
    platform: "darwin",
    architecture: "arm64",
  });
  assert.deepEqual(result, credential);
  assert.equal(requests[0]?.url.pathname, "/runtime-host/v1/pairing/claim");
  assert.equal(requests[0]?.headers.get("Authorization"), null);
  assert.deepEqual(requests[0]?.body, {
    protocolVersion: "nanthai.runtime.pairing.v1",
    pairingId: "pairing-1",
    oneTimeCode: "one-time-code",
    hostNonce: "nonce-1",
    hostPublicKey: "public-key-1",
    device: {
      displayName: "Dino Mac",
      platform: { operatingSystem: "macos", architecture: "arm64", release: "25.6.0" },
      hostVersion: "0.1.0",
    },
  });
});

test("HTTP host transport claims a packet command and preserves raw event envelopes", async () => {
  const requests: CapturedRequest[] = [];
  const packet = runtimePacket();
  const fetchImplementation = captureFetch(requests, (request) => {
    switch (request.url.pathname) {
      case "/runtime-host/v1/presence/heartbeat": return json({
        presenceId: "presence-1", serverTime: 1_786_752_000_000,
        expiresAt: 1_786_752_060_000,
      });
      case "/runtime-host/v1/commands/poll": return json({
        commands: [{
          commandRecordId: "record-1",
          runId: packet.runId,
          attemptId: packet.attemptId,
          fence: packet.fence,
          commandId: packet.command.commandId,
          type: "start",
          authorizationSource: "paired_device",
          inputHash: "transport-envelope-hash",
          turnPacketId: "packet-1",
          createdAt: 1_786_752_000_000,
        }],
        serverTime: 1_786_752_000_001,
      });
      case "/runtime-host/v1/commands/claim": return json({
        claimed: true, leaseExpiresAt: 1_786_752_060_000, claimantId: "claimant-1",
      });
      case "/runtime-host/v1/packets/fetch": return new Response(JSON.stringify(packet), {
        headers: { "X-NanthAI-Packet-SHA256": packet.command.packetHash },
      });
      case "/runtime-host/v1/events": return json({ acceptedEventIds: ["event-1"] });
      case "/runtime-host/v1/commands/complete": return json({ changed: true });
      case "/runtime-host/v1/attempts/heartbeat": return json({
        leaseExpiresAt: 1_786_752_060_000,
      });
      case "/runtime-host/v1/attempts/settle": return json({ settled: true });
      case "/runtime-host/v1/presence/disconnect": return json({ changed: true });
      default: throw new Error(`Unexpected request: ${request.url.pathname}`);
    }
  });
  const transport = new HttpRuntimeControlPlane({
    fetch: fetchImplementation,
    now: () => 1_786_752_000_010,
    operatingSystemRelease: () => "25.6.0",
    createPresenceSessionId: () => "presence-session-1",
    delay: waitForAbort,
  });
  const connection = await transport.connect(credential, registration());
  const iterator = connection.commands()[Symbol.asyncIterator]();
  const next = await iterator.next();
  assert.equal(next.done, false);
  assert.equal(next.value.kind, "start");
  const payload = next.value.payload as ClaimedCommandPayload;
  assert.equal(payload.packet?.command.packetHash, packet.command.packetHash);
  assert.equal(payload.packetError, null);

  const receipt = await connection.publish([failureEvent()]);
  assert.deepEqual(receipt.acceptedEventIds, ["event-1"]);
  await connection.completeCommand("record-1", "completed");
  assert.equal(await connection.heartbeatAttempt(packet.attemptId, packet.fence), 1_786_752_060_000);
  await connection.settleAttempt(packet.attemptId, packet.fence, "completed");
  await connection.heartbeat({
    emittedAtMs: 1, activeAttempts: 1, queuedEvents: 0, rssBytes: 2, heapUsedBytes: 1,
  });
  const pendingPoll = iterator.next();
  connection.stopReceiving();
  assert.equal((await pendingPoll).done, true);
  assert.equal(requests.some(request => request.url.pathname.endsWith("presence/disconnect")), false);
  await connection.publish([failureEvent()]);
  await connection.completeCommand("record-1", "rejected", "host stopped");
  await connection.settleAttempt(packet.attemptId, packet.fence, "interrupted");
  await connection.close();
  await connection.close({ executionStopped: true });
  assert.deepEqual(requests.filter(request => request.url.pathname.endsWith("presence/disconnect")).map(request => request.body), [{ reason: "host_closed" }, { reason: "host_closed", executionStopped: true }]);

  for (const request of requests.filter((item) => item.url.pathname !== "/runtime-host/v1/pairing/claim")) {
    assert.equal(request.headers.get("Authorization"), "Bearer opaque-secret");
    assert.equal(request.headers.get("X-NanthAI-Device-ID"), "device-1");
    assert.equal(request.headers.get("X-NanthAI-Credential-ID"), "credential-1");
    assert.equal(request.headers.get("X-NanthAI-Presence-Session-ID"), "presence-session-1");
  }
  const presence = requests.find((item) => item.url.pathname.endsWith("presence/heartbeat"));
  assert.equal("deviceId" in (presence?.body ?? {}), false);
  const published = requests.find((item) => item.url.pathname.endsWith("/events"));
  assert.deepEqual(published?.body, { events: [failureEvent()] });
});

test("HTTP packet integrity failure becomes a command rejection payload, not a lost claim", async () => {
  const packet = runtimePacket();
  const fetchImplementation = captureFetch([], (request) => {
    if (request.url.pathname.endsWith("presence/heartbeat")) {
      return json({ presenceId: "p", serverTime: 1, expiresAt: 2 });
    }
    if (request.url.pathname.endsWith("commands/poll")) return json({ commands: [{
      commandRecordId: "record-1", runId: packet.runId, attemptId: packet.attemptId,
      fence: 1, commandId: packet.command.commandId, type: "start",
      authorizationSource: "paired_device", inputHash: "transport-envelope-hash",
      turnPacketId: "packet-1", createdAt: 1,
    }], serverTime: 1 });
    if (request.url.pathname.endsWith("commands/claim")) return json({ claimed: true });
    if (request.url.pathname.endsWith("packets/fetch")) {
      return new Response(JSON.stringify(packet), { headers: {
        "X-NanthAI-Packet-SHA256": "f".repeat(64),
      } });
    }
    if (request.url.pathname.endsWith("presence/disconnect")) return json({ changed: true });
    throw new Error(`Unexpected request: ${request.url.pathname}`);
  });
  const connection = await new HttpRuntimeControlPlane({
    fetch: fetchImplementation,
    createPresenceSessionId: () => "session-1",
    now: () => 1,
  }).connect(credential, registration());
  const next = await connection.commands()[Symbol.asyncIterator]().next();
  const payload = next.value.payload as ClaimedCommandPayload;
  assert.equal(payload.packet, null);
  assert.match(payload.packetError ?? "", /hash does not match/);
  await connection.close();
});

function registration() {
  const capabilities = canonicalCodexCapabilities(APP_SERVER_CAPABILITIES);
  return {
    deviceId: "device-1",
    owner: "foreground_cli" as const,
    hostVersion: "0.1.0",
    hostname: "Dino Mac",
    platform: "darwin" as const,
    architecture: "arm64",
    adapters: [{
      adapterId: "codex",
      adapterVersion: capabilities.adapterVersion,
      authState: "ready" as const,
      capabilities,
    }],
  };
}

function failureEvent(): RuntimeEvent {
  return {
    eventId: "event-1", commandRecordId: "record-1", commandId: "command-1",
    runId: "run-1", attemptId: "attempt-1", fence: 1,
    kind: "host_command_failed", emittedAtMs: 1,
    payload: { message: "bounded failure" },
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
    assert.equal(request.signal.aborted, false, "settlement must retain a live transport signal");
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
