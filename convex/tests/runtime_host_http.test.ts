import assert from "node:assert/strict";
import test from "node:test";
import { createMockCtx } from "../../test_helpers/convex_mock_ctx";
import { fetchRuntimePacketHttp } from "../runtime_host/http_commands";
import { runtimeHostHeaders } from "../runtime_host/http_common";
import { publishRuntimeEventsHttp } from "../runtime_host/http_events";
import {
  completeModelDiscoveryHttp,
  pollModelDiscoveryHttp,
} from "../runtime_host/http_model_discovery";

const authHeaders = {
  Authorization: "Bearer runtime-secret",
  "X-NanthAI-Device-ID": "device-1",
  "X-NanthAI-Credential-ID": "credential-1",
  "X-NanthAI-Presence-Session-ID": "presence-1",
};

function post(path: string, body: unknown): Request {
  return new Request(`https://runtime.example${path}`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("runtime HTTP auth is header-only and requires the active presence identity", () => {
  assert.deepEqual(runtimeHostHeaders(post("/commands/poll", {})), {
    deviceId: "device-1",
    credentialId: "credential-1",
    credential: "runtime-secret",
    presenceSessionId: "presence-1",
  });
  assert.throws(() => runtimeHostHeaders(new Request("https://runtime.example", {
    headers: { Authorization: "Bearer runtime-secret" },
  })), /credential and presence headers are required/);
});

test("event batches preserve raw payloads and ACK only accepted or replayed events", async () => {
  const calls: unknown[] = [];
  const ctx = createMockCtx({
    runMutation: async (_reference: unknown, args: unknown) => {
      calls.push(args);
      const value = args as { events: { eventId: string }[] };
      return value.events.filter((event) => event.eventId !== "event-rejected")
        .map((event) => event.eventId);
    },
  });
  const response = await publishRuntimeEventsHttp(ctx, post("/events", {
    events: [
      {
        eventId: "event-accepted",
        commandRecordId: "command-record-1",
        commandId: "command-1",
        runId: "run-1",
        attemptId: "attempt-1",
        fence: 1,
        kind: "host_command_failed",
        emittedAtMs: 1_000,
        payload: { message: "Codex process exited" },
      },
      {
        eventId: "event-rejected",
        commandRecordId: "command-record-1",
        commandId: "command-1",
        runId: "run-1",
        attemptId: "attempt-1",
        fence: 1,
        kind: "host_command_failed",
        emittedAtMs: 1_001,
        payload: { message: "A second failure" },
      },
    ],
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { acceptedEventIds: ["event-accepted"] });
  assert.equal(calls.length, 1);
  assert.deepEqual((calls[0] as { events: unknown[] }).events[0], {
    eventId: "event-accepted",
    commandRecordId: "command-record-1",
    commandId: "command-1",
    runId: "run-1",
    attemptId: "attempt-1",
    fence: 1,
    kind: "host_command_failed",
    emittedAtMs: 1_000,
    payload: { message: "Codex process exited" },
  });
});

test("packet fetch returns the immutable storage bytes and integrity envelope", async () => {
  const packet = new Blob(["{\"protocolVersion\":\"nanthai.runtime.v1\"}"], {
    type: "application/json",
  });
  const ctx = createMockCtx({
    runQuery: async () => ({
      storageId: "storage-1",
      packetHash: "a".repeat(64),
      byteLength: packet.size,
      expiresAt: 90_000,
    }),
    storage: {
      get: async () => packet,
      getUrl: async () => null,
      store: async () => "unused",
    },
  });
  const request = new Request(
    "https://runtime.example/runtime-host/v1/packets/fetch?packetId=packet-1",
    { headers: authHeaders },
  );
  const response = await fetchRuntimePacketHttp(ctx, request);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("ETag"), `"${"a".repeat(64)}"`);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(await response.text(), await packet.text());
});

test("model discovery HTTP poll claims work and completion forwards protocol models", async () => {
  const calls: unknown[] = [];
  const requestId = "discovery-request-1";
  const ctx = createMockCtx({
    runMutation: async (_reference: unknown, args: unknown) => {
      calls.push(args);
      if (calls.length === 1) {
        return [{ requestId, adapterId: "codex", expiresAt: 120_000 }];
      }
      return true;
    },
  });
  const poll = await pollModelDiscoveryHttp(
    ctx,
    post("/runtime-host/v1/model-discovery/poll", {}),
  );
  assert.equal(poll.status, 200);
  const pollBody = await poll.json() as { requests: unknown[] };
  assert.deepEqual(pollBody.requests, [{ requestId, adapterId: "codex", expiresAt: 120_000 }]);
  assert.deepEqual(calls[0], {
    deviceId: "device-1",
    credentialId: "credential-1",
    credential: "runtime-secret",
    presenceSessionId: "presence-1",
  });

  const models = [{
    provider: "openai",
    modelId: "gpt-5.6-codex",
    displayName: "GPT-5.6 Codex",
    availability: "available",
    unavailableReason: null,
    inputModalities: ["text", "image"],
    supportsTools: true,
    supportsReasoning: true,
  }];
  const completed = await completeModelDiscoveryHttp(
    ctx,
    post("/runtime-host/v1/model-discovery/complete", {
      requestId,
      status: "completed",
      models,
    }),
  );
  assert.equal(completed.status, 200);
  assert.deepEqual(await completed.json(), { changed: true });
  assert.deepEqual(calls[1], {
    deviceId: "device-1",
    credentialId: "credential-1",
    credential: "runtime-secret",
    presenceSessionId: "presence-1",
    requestId,
    status: "completed",
    models,
  });
});
