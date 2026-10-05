import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { AttemptSessionManager } from "../src/attempt_session_manager.ts";
import {
  HostAlreadyRunningError,
  HostLock,
  isProcessPresent,
} from "../src/host_lock.ts";
import { FileOutboundSpool, SpoolCapacityError } from "../src/outbound_spool.ts";

const idleWorker = fileURLToPath(
  new URL("./fixtures/fake_idle_worker.mjs", import.meta.url),
);

test("host lock prevents a second live owner and replaces a stale owner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanthai-host-lock-"));
  const path = join(directory, "host.lock");
  try {
    const first = await HostLock.acquire(path, "foreground_cli", 101, () => 10, () => true);
    await assert.rejects(
      () => HostLock.acquire(path, "tray", 202, () => 20, () => true),
      (error: unknown) => error instanceof HostAlreadyRunningError
        && error.record?.owner === "foreground_cli",
    );
    await first.release();
    const stale = await HostLock.acquire(path, "foreground_cli", 303, () => 30, () => false);
    const replacement = await HostLock.acquire(path, "tray", 404, () => 40, () => false);
    assert.equal(replacement.record.pid, 404);
    assert.equal(replacement.record.owner, "tray");
    await stale.release();
    await replacement.release();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("host lock recovers a stale owner when process probing reports ESRCH", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanthai-host-lock-esrch-"));
  const path = join(directory, "host.lock");
  const deadProcess = (pid: number) => isProcessPresent(pid, () => {
    throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
  });
  try {
    const stale = await HostLock.acquire(path, "foreground_cli", 505, () => 50);
    const replacement = await HostLock.acquire(path, "tray", 606, () => 60, deadProcess);
    assert.equal(replacement.record.pid, 606);
    await stale.release();
    await replacement.release();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("durable spool survives reload, deduplicates, acknowledges, and never evicts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanthai-spool-"));
  const path = join(directory, "events.json");
  try {
    const spool = new FileOutboundSpool(path, { maxEvents: 2, maxBytes: 100_000 });
    await spool.enqueue(event("event-1"));
    await spool.enqueue(event("event-1"));
    await spool.enqueue(event("event-2"));
    await assert.rejects(() => spool.enqueue(event("event-3")), SpoolCapacityError);
    assert.deepEqual((await new FileOutboundSpool(path).peek(10)).map((item) => item.eventId), [
      "event-1", "event-2",
    ]);
    await spool.acknowledge(["event-1"]);
    assert.deepEqual((await spool.peek(10)).map((item) => item.eventId), ["event-2"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("session manager owns concurrent isolated workers and reports resources", async () => {
  const manager = new AttemptSessionManager(10, () => 1_786_752_000_999);
  const firstPid = manager.start(descriptor("attempt-1", "participant-1"), {
    command: process.execPath,
    args: [idleWorker],
  });
  const secondPid = manager.start(descriptor("attempt-2", "participant-2"), {
    command: process.execPath,
    args: [idleWorker],
  });
  assert.notEqual(firstPid, secondPid);
  assert.equal(manager.activeCount(), 2);
  const summaries = await manager.summaries();
  assert.deepEqual(summaries.filter((summary) => summary.state === "running")
    .map((summary) => summary.attemptId).sort(), ["attempt-1", "attempt-2"]);
  await manager.cancel("attempt-1", 50);
  assert.equal(manager.activeCount(), 1);
  await manager.closeAll(50);
  assert.equal(manager.activeCount(), 0);
  const completed = await manager.summaries();
  assert.equal(completed.every((summary) => summary.state === "cancelled"), true);
});

function event(eventId: string) {
  return {
    eventId,
    commandRecordId: "record-1",
    commandId: "command-1",
    runId: "run-1",
    attemptId: "attempt-1",
    fence: 1,
    kind: "host_command_failed" as const,
    emittedAtMs: 1_786_752_000_000,
    payload: { value: eventId },
  };
}

function descriptor(attemptId: string, personaParticipantId: string) {
  return {
    attemptId,
    personaParticipantId,
    adapter: "codex_app_server" as const,
    workingDirectory: null,
    startedAtMs: 1_786_752_000_000,
  };
}
