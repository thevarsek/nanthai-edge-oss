import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InMemoryControlPlane } from "../src/control_plane.ts";
import { HostStatusStore } from "../src/host_status_store.ts";
import { InMemoryOutboundSpool } from "../src/outbound_spool.ts";
import { ForegroundRuntimeHost } from "../src/runtime_host.ts";

test("revoked early disconnect cannot interrupt the post-shutdown stop receipt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanthai-stop-receipt-"));
  const plane = new InMemoryControlPlane();
  const originalConnect = plane.connect.bind(plane);
  let connected = false;
  let shutdown = false;
  let received = false;
  plane.connect = async (...args) => {
    const connection = await originalConnect(...args);
    connection.close = async (options) => {
      plane.endCommands();
      if (!options?.executionStopped) throw new Error("Revoked credential");
      assert.equal(shutdown, true);
      received = true;
    };
    connected = true;
    return connection;
  };
  const host = new ForegroundRuntimeHost(
    { deviceId: "device", credentialId: "credential", credential: "secret", controlPlaneUrl: "https://example.test" },
    plane, new InMemoryOutboundSpool(), new HostStatusStore(join(directory, "status.json")),
    { activeCount: () => 0, execute: async () => undefined, shutdown: async () => { shutdown = true; } },
    { lockPath: join(directory, "host.lock"), hostVersion: "test", adapters: [] },
  );
  try {
    const running = host.run();
    for (let tries = 0; !connected && tries < 100; tries++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(connected, true);
    host.requestStop();
    await running;
    assert.equal(received, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("poll failure stops intake before workers drain and disconnects after shutdown", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanthai-poll-failure-"));
  const plane = new InMemoryControlPlane();
  const pollError = new Error("Host presence expired");
  plane.commands = () => ({
    [Symbol.asyncIterator]: () => ({ next: async () => { throw pollError; } }),
  });
  let closed = false;
  let receivingStopped = false;
  const stopReceiving = plane.stopReceiving.bind(plane);
  plane.stopReceiving = () => { receivingStopped = true; stopReceiving(); };
  const close = plane.close.bind(plane);
  plane.close = async () => { closed = true; await close(); };
  const host = new ForegroundRuntimeHost(
    { deviceId: "device", credentialId: "credential", credential: "fixture", controlPlaneUrl: "https://example.test" },
    plane, new InMemoryOutboundSpool(), new HostStatusStore(join(directory, "status.json")),
    {
      activeCount: () => 0, execute: async () => undefined,
      shutdown: async () => { assert.equal(receivingStopped, true); assert.equal(closed, false); },
    },
    { lockPath: join(directory, "host.lock"), hostVersion: "test", adapters: [] },
  );
  try {
    await assert.rejects(host.run(), pollError);
    assert.equal(closed, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
