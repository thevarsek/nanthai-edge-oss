import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InMemoryControlPlane } from "../src/control_plane.ts";
import { HostStatusStore } from "../src/host_status_store.ts";
import { FileOutboundSpool } from "../src/outbound_spool.ts";
import { ForegroundRuntimeHost } from "../src/runtime_host.ts";

test("startup replay renews presence while its first upload is blocked", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanthai-replay-heartbeat-"));
  const spool = new FileOutboundSpool(join(directory, "events.json"));
  await spool.enqueue({
    eventId: "event-1", commandRecordId: "record-1", commandId: "command-1",
    runId: "run-1", attemptId: "attempt-1", fence: 1, kind: "host_command_failed",
    emittedAtMs: 1, payload: { message: "retained after restart" },
  });
  const control = new InMemoryControlPlane();
  const publish = control.publish.bind(control);
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let uploading = false;
  control.publish = async (events) => { uploading = true; await gate; return publish(events); };
  const host = new ForegroundRuntimeHost(
    { deviceId: "device-1", credentialId: "credential-1", credential: "fixture", controlPlaneUrl: "https://example.test" },
    control, spool, new HostStatusStore(join(directory, "status.json")),
    { activeCount: () => 0, shutdown: async () => {}, execute: async () => {} },
    { lockPath: join(directory, "host.lock"), hostVersion: "test", adapters: [], heartbeatIntervalMs: 5 },
  );
  const running = host.run();
  void running.catch(() => undefined);
  try {
    for (let index = 0; index < 100 && control.heartbeats.length < 2; index++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(uploading, true);
    assert.ok(control.heartbeats.length >= 2, "replay must not block presence renewal");
    assert.equal(control.heartbeats[0]?.queuedEvents, 1);
    assert.equal(control.published.length, 0);
    release();
    control.endCommands();
    await running;
    assert.equal((await spool.size()).events, 0);
  } finally {
    release();
    control.endCommands();
    await running.catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});
