import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { WireWorker, WorkerProcessError } from "../src/wire_worker.ts";

const fixture = fileURLToPath(
  new URL("./fixtures/fake_crashing_tree_parent.mjs", import.meta.url),
);

test("worker crash drains descendants before reporting failure", async (context) => {
  if (process.platform === "win32") {
    context.skip("POSIX-only process group test");
    return;
  }
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "nanthai-wire-worker-"));
  const pidFile = join(temporaryDirectory, "grandchild.pid");
  const worker = WireWorker.spawn({
    command: process.execPath,
    args: [fixture, pidFile],
  });
  context.after(async () => {
    forceKillGroup(worker.pid);
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  const grandchildPid = await readPidFile(pidFile);
  assert.equal(isProcessPresent(grandchildPid), true);

  assert.deepEqual(await worker.exit, { code: 17, signal: null });
  assert.equal(await processExists(grandchildPid), false);
  assert.equal(isProcessGroupPresent(worker.pid), false);

  const iterator = worker[Symbol.asyncIterator]();
  await assert.rejects(
    () => iterator.next(),
    (error: unknown) => {
      assert.equal(error instanceof WorkerProcessError, true);
      if (!(error instanceof WorkerProcessError)) return false;
      assert.deepEqual(error.exit, { code: 17, signal: null });
      assert.match(error.message, /Worker crashed \(17\)/);
      return true;
    },
  );

});

async function readPidFile(path: string): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const pid = Number((await readFile(path, "utf8")).trim());
      if (Number.isInteger(pid) && pid > 0) return pid;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Grandchild PID file was not written");
}

async function processExists(pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!isProcessPresent(pid)) return false;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return true;
}

function isProcessPresent(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

function isProcessGroupPresent(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

function forceKillGroup(processGroupId: number): void {
  try {
    process.kill(-processGroupId, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}
