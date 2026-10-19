import assert from "node:assert/strict";
import test from "node:test";

import { canonicalCodexCapabilities } from "../src/canonical_capabilities.ts";
import { APP_SERVER_CAPABILITIES } from "../src/codex_capabilities.ts";
import { HttpRuntimeControlPlane } from "../src/http_runtime_transport.ts";
import { FakePendingWorkSource } from "./fixtures/pending_work_source.ts";

const credential = {
  deviceId: "device-1",
  credentialId: "credential-1",
  controlPlaneUrl: "https://example-123.convex.site",
  credential: "opaque-secret",
};

test("push transport stays quiet while idle and claims only after the subscription reports work", async () => {
  const paths: string[] = [];
  let pendingCommands: unknown[] = [];
  let pendingDiscovery: unknown[] = [];
  const fetchImplementation: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    paths.push(path);
    switch (path) {
      case "/runtime-host/v1/presence/heartbeat":
        return Response.json({ presenceId: "presence-1", serverTime: 1, expiresAt: 2 });
      case "/runtime-host/v1/realtime":
        assert.equal(request.headers.get("Authorization"), null, "discovery sends no credential");
        return Response.json({ realtimeUrl: "https://example-123.convex.cloud" });
      case "/runtime-host/v1/commands/poll": {
        const commands = pendingCommands;
        pendingCommands = [];
        return Response.json({ commands, serverTime: 1 });
      }
      case "/runtime-host/v1/commands/claim":
        return Response.json({ claimed: true });
      case "/runtime-host/v1/model-discovery/poll": {
        const requests = pendingDiscovery;
        pendingDiscovery = [];
        return Response.json({ requests, serverTime: 1 });
      }
      case "/runtime-host/v1/presence/disconnect":
        return Response.json({ changed: true });
      default: throw new Error(`Unexpected request: ${path}`);
    }
  };
  const source = new FakePendingWorkSource();
  const opened: Array<{ url: string; args: unknown }> = [];
  let timedPolls = 0;
  const connection = await new HttpRuntimeControlPlane({
    fetch: fetchImplementation,
    createPresenceSessionId: () => "presence-session-1",
    now: () => 1,
    operatingSystemRelease: () => "25.6.0",
    delay: async () => { timedPolls += 1; await new Promise((resolve) => setTimeout(resolve, 1)); },
    pendingWorkSource: (url, args) => {
      opened.push({ url, args });
      return source;
    },
  }).connect(credential, registration());
  assert.deepEqual(opened, [{
    url: "https://example-123.convex.cloud",
    args: {
      deviceId: "device-1", credentialId: "credential-1",
      credential: "opaque-secret", presenceSessionId: "presence-session-1",
    },
  }]);
  source.push([], []);

  const commands = connection.commands()[Symbol.asyncIterator]();
  const discovery = connection.modelDiscoveryRequests()[Symbol.asyncIterator]();
  const nextCommand = commands.next();
  const nextDiscovery = discovery.next();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const count = (suffix: string) => paths.filter((path) => path.endsWith(suffix)).length;
  assert.equal(count("commands/poll"), 1, "one start-up poll, then silence");
  assert.equal(count("model-discovery/poll"), 1);
  assert.equal(timedPolls, 0);

  pendingCommands = [{
    commandRecordId: "record-1", runId: "run-1", attemptId: "attempt-1", fence: 1,
    commandId: "command-1", type: "cancel", authorizationSource: "paired_device",
    inputHash: "hash", createdAt: 1,
  }];
  source.push(["record-1"], []);
  const claimed = await nextCommand;
  assert.equal(claimed.value?.commandRecordId, "record-1");
  assert.equal(count("commands/poll"), 2);
  assert.equal(count("model-discovery/poll"), 1, "command work does not wake discovery");

  pendingDiscovery = [{ requestId: "discovery-1", adapterId: "codex", expiresAt: 10 }];
  source.push([], ["discovery-1"]);
  assert.equal((await nextDiscovery).value?.requestId, "discovery-1");

  const pendingCommand = commands.next();
  const pendingDiscoveryNext = discovery.next();
  await connection.close();
  assert.equal((await pendingCommand).done, true);
  assert.equal((await pendingDiscoveryNext).done, true);
  assert.equal(source.closed, true);
  assert.equal(timedPolls, 0);
});

test("push transport keeps timed polling against a control plane without the realtime endpoint", async () => {
  let polls = 0;
  const fetchImplementation: typeof fetch = async (input) => {
    const path = new URL(new Request(input).url).pathname;
    if (path.endsWith("presence/heartbeat")) return Response.json({ presenceId: "p", serverTime: 1, expiresAt: 2 });
    if (path.endsWith("/realtime")) return new Response("No matching routes found", { status: 404 });
    if (path.endsWith("commands/poll")) { polls += 1; return Response.json({ commands: [], serverTime: 1 }); }
    if (path.endsWith("presence/disconnect")) return Response.json({ changed: true });
    throw new Error(`Unexpected request: ${path}`);
  };
  let opened = false;
  const connection = await new HttpRuntimeControlPlane({
    fetch: fetchImplementation,
    createPresenceSessionId: () => "s",
    operatingSystemRelease: () => "25.6.0",
    delay: () => new Promise((resolve) => setTimeout(resolve, 1)),
    pendingWorkSource: () => { opened = true; return new FakePendingWorkSource(); },
  }).connect(credential, registration());
  const next = connection.commands()[Symbol.asyncIterator]().next();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(opened, false);
  assert.ok(polls >= 3, `expected timed polling, saw ${polls} polls`);
  await connection.close();
  assert.equal((await next).done, true);
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
