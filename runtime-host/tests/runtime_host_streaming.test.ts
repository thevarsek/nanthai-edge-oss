import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InMemoryControlPlane, type RuntimeCommand, type RuntimeEvent } from "../src/control_plane.ts";
import { HostStatusStore } from "../src/host_status_store.ts";
import { InMemoryOutboundSpool } from "../src/outbound_spool.ts";
import { ForegroundRuntimeHost } from "../src/runtime_host.ts";

test("slow root text delivery batches queued deltas and publishes terminal before settling", () => verifyBatching("root"));
test("slow native child text delivery batches queued deltas and publishes terminal before settling", () => verifyBatching("native_child"));
test("failed text delivery shares one flush and preserves queued events during shutdown", () => verifyBatching("root", true));

async function verifyBatching(stream: "root" | "native_child", publisherFails = false) {
  const directory = await mkdtemp(join(tmpdir(), "nanthai-streaming-batch-"));
  let releasePublish = () => {};
  let queued = () => {};
  const gate = new Promise<void>((resolve) => { releasePublish = resolve; });
  const queuedDeltas = new Promise<void>((resolve) => { queued = resolve; });
  const batches: number[] = [];
  class SlowControlPlane extends InMemoryControlPlane {
    override async publish(events: readonly RuntimeEvent[]) {
      batches.push(events.length);
      await gate;
      if (publisherFails) throw new Error("Delivery unavailable");
      return await super.publish(events);
    }
  }
  const control = new SlowControlPlane();
  const command: RuntimeCommand = {
    commandRecordId: "record-stream", commandId: "stream", runId: "run-stream",
    attemptId: "attempt-stream", fence: 1, kind: "start", receivedAtMs: 1, payload: null,
  };
  const event = (sequence: number, terminal = false): RuntimeEvent => ({
    commandRecordId: command.commandRecordId, commandId: command.commandId,
    runId: command.runId, attemptId: command.attemptId, fence: command.fence,
    eventId: `stream:${sequence}`, kind: "worker_message", emittedAtMs: 1,
    payload: terminal
      ? { kind: "terminal_event", payload: { event: { outcome: "completed" } } }
      : { kind: "adapter_event", payload: { event: stream === "root"
        ? { type: sequence % 2 === 0 ? "text_delta" : "reasoning_delta", delta: "orchid" }
        : { type: "native_agent_activity", kind: sequence % 2 === 0 ? "message" : "reasoning", summary: "orchid" } } },
  });
  const spool = new InMemoryOutboundSpool();
  const host = new ForegroundRuntimeHost(
    { deviceId: "device-1", credentialId: "credential-1", credential: "fixture", controlPlaneUrl: "https://example.test" },
    control, spool, new HostStatusStore(join(directory, "status.json")),
    {
      activeCount: () => 0,
      shutdown: async () => {},
      execute: async (_command, emit) => {
        for (let sequence = 0; sequence < 100; sequence++) await emit(event(sequence));
        queued();
        await emit(event(100, true));
      },
    },
    { lockPath: join(directory, "host.lock"), hostVersion: "fixture", adapters: [], heartbeatIntervalMs: 5 },
  );
  const running = host.run();
  void running.catch(() => undefined);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    control.enqueue(command);
    await Promise.race([
      queuedDeltas,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Text delivery blocked the worker behind a single HTTP acknowledgement")), 5_000);
      }),
    ]);
    assert.equal(control.completedCommands.length, 0);
    releasePublish();
    if (publisherFails) {
      await assert.rejects(running, /Delivery unavailable/);
      assert.ok(batches.length <= 2, `Queued ${batches.length} redundant delivery attempts`);
      assert.equal(control.published.length, 0);
      assert.equal((await spool.size()).events, 102);
      return;
    }
    control.endCommands();
    await running;
    assert.equal(batches.some((size) => size > 1), true);
    assert.equal(control.published.length, 101);
    assert.deepEqual(control.settledAttempts, [{ attemptId: "attempt-stream", fence: 1, outcome: "completed" }]);
    assert.equal(control.operations.indexOf("publish:stream:100") < control.operations.indexOf("complete:record-stream:completed"), true);
    assert.equal((await spool.size()).events, 0);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    releasePublish();
    control.endCommands();
    await running.catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
}
