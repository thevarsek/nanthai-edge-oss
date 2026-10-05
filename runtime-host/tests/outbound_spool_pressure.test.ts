import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { RuntimeEvent } from "../src/control_plane.ts";
import { FileOutboundSpool } from "../src/outbound_spool.ts";

test("a burst coalesces durable writes while heartbeat metrics remain available", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanthai-spool-pressure-"));
  const path = join(directory, "events.json");
  const spool = new FileOutboundSpool(path);
  const writer = spool as unknown as { write(events: readonly RuntimeEvent[]): Promise<void> };
  const originalWrite = writer.write.bind(spool);
  let release = () => {};
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let writes = 0;
  writer.write = async (events) => {
    writes += 1;
    await blocked;
    await originalWrite(events);
  };
  try {
    await spool.size();
    const enqueues = Array.from({ length: 1_000 }, (_, index) => spool.enqueue(event(index)));
    assert.equal((await spool.size()).events, 1_000);
    assert.equal(writes, 1);
    let published = false;
    const peek = spool.peek(1_000).then((events) => { published = true; return events; });
    await Promise.resolve();
    assert.equal(published, false, "unpersisted events must not be published");
    release();
    await Promise.all(enqueues);
    assert.equal(writes, 2);
    const durable = await new FileOutboundSpool(path).peek(1_000);
    assert.deepEqual(await peek, durable);
    assert.deepEqual(durable.map((value) => value.eventId),
      Array.from({ length: 1_000 }, (_, index) => `event-${index}`));
    assert.equal((await new FileOutboundSpool(path).size()).bytes, (await spool.size()).bytes);
    await Promise.all([spool.acknowledge(durable.slice(0, 500).map((value) => value.eventId)),
      spool.enqueue(event(1_000))]);
    assert.equal((await new FileOutboundSpool(path).size()).events, 501);
  } finally {
    release();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a failed durable write is retried without losing or prematurely publishing events", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanthai-spool-retry-"));
  const path = join(directory, "events.json");
  const spool = new FileOutboundSpool(path);
  const writer = spool as unknown as { write(events: readonly RuntimeEvent[]): Promise<void> };
  const originalWrite = writer.write.bind(spool);
  writer.write = async () => { throw new Error("disk unavailable"); };
  try {
    await assert.rejects(spool.enqueue(event(1)), /disk unavailable/);
    await assert.rejects(spool.peek(10), /disk unavailable/);
    writer.write = originalWrite;
    await spool.enqueue(event(1));
    assert.deepEqual(await new FileOutboundSpool(path).peek(10), [event(1)]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function event(index: number): RuntimeEvent {
  return {
    eventId: `event-${index}`, commandRecordId: "record-1", commandId: "command-1",
    runId: "run-1", attemptId: "attempt-1", fence: 1, kind: "host_command_failed",
    emittedAtMs: index, payload: { message: "synthetic queue pressure" },
  };
}
