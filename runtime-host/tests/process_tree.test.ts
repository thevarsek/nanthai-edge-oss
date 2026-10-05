import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { OwnedProcess, processTreeSupport } from "../src/process_tree.ts";

const fixture = fileURLToPath(new URL("./fixtures/fake_tree_parent.mjs", import.meta.url));
const crashingFixture = fileURLToPath(
  new URL("./fixtures/fake_crashing_tree_parent.mjs", import.meta.url),
);

test("reports the unimplemented Windows Job Object boundary", () => {
  assert.deepEqual(processTreeSupport("win32"), {
    supported: false,
    mode: "windows_job_object_required",
  });
});

test("terminates the complete POSIX process group", async (context) => {
  if (process.platform === "win32") {
    context.skip("POSIX-only process group test");
    return;
  }
  const owned = OwnedProcess.spawn({ command: process.execPath, args: [fixture] });
  const grandchildPid = await readPid(owned.child.stdout);
  await owned.terminate(25);

  assert.equal(await processExists(owned.pid), false);
  assert.equal(await processExists(grandchildPid), false);
});

test("drains the retained process group after its leader exits", async (context) => {
  if (process.platform === "win32") {
    context.skip("POSIX-only process group test");
    return;
  }
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "nanthai-process-tree-"));
  const pidFile = join(temporaryDirectory, "grandchild.pid");
  const owned = OwnedProcess.spawn({
    command: process.execPath,
    args: [crashingFixture, pidFile],
  });
  context.after(async () => {
    forceKillGroup(owned.pid);
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  const grandchildPid = await readPidFile(pidFile);
  assert.equal(isProcessPresent(grandchildPid), true);
  assert.deepEqual(await owned.exit, { code: 17, signal: null });

  await owned.terminate(25);

  assert.equal(await processExists(grandchildPid), false);
  assert.equal(isProcessGroupPresent(owned.pid), false);
});

async function readPid(stream: NodeJS.ReadableStream): Promise<number> {
  return new Promise((resolve, reject) => {
    stream.once("data", (chunk) => resolve(Number(String(chunk).trim())));
    stream.once("error", reject);
  });
}

async function processExists(pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return true;
}

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
