import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

const LockRecordSchema = z.strictObject({
  token: z.string().uuid(),
  pid: z.number().int().positive(),
  owner: z.enum(["foreground_cli", "tray"]),
  acquiredAtMs: z.number().int().nonnegative(),
});

export type HostLockRecord = z.infer<typeof LockRecordSchema>;

export class HostAlreadyRunningError extends Error {
  constructor(readonly record: HostLockRecord | null) {
    super(record === null
      ? "Another Runtime Host owns the local host lock"
      : `Runtime Host is already running as PID ${record.pid} (${record.owner})`);
    this.name = "HostAlreadyRunningError";
  }
}

export class HostLock {
  private released = false;

  private constructor(
    private readonly path: string,
    readonly record: HostLockRecord,
  ) {}

  static async acquire(
    path: string,
    owner: HostLockRecord["owner"],
    pid = process.pid,
    now = Date.now,
    processExists: (pid: number) => boolean = isProcessPresent,
  ): Promise<HostLock> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const record = { token: randomUUID(), pid, owner, acquiredAtMs: now() };
    if (await tryWriteExclusive(path, record)) return new HostLock(path, record);
    const current = await readLock(path);
    if (current !== null && processExists(current.pid)) {
      throw new HostAlreadyRunningError(current);
    }
    await recoverStaleLock(path, record, processExists);
    return new HostLock(path, record);
  }

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    const current = await readLock(this.path);
    if (current?.token !== this.record.token) return;
    await unlink(this.path).catch((error: unknown) => {
      if (!isMissingFile(error)) throw error;
    });
  }
}

async function recoverStaleLock(
  path: string,
  record: HostLockRecord,
  processExists: (pid: number) => boolean,
): Promise<void> {
  const recoveryPath = `${path}.recovery`;
  if (!(await tryWriteExclusive(recoveryPath, record))) {
    const recovery = await readLock(recoveryPath);
    if (recovery !== null && processExists(recovery.pid)) {
      throw new HostAlreadyRunningError(recovery);
    }
    await removeFile(recoveryPath);
    if (!(await tryWriteExclusive(recoveryPath, record))) {
      throw new HostAlreadyRunningError(await readLock(recoveryPath));
    }
  }
  try {
    const current = await readLock(path);
    if (current !== null && processExists(current.pid)) {
      throw new HostAlreadyRunningError(current);
    }
    await removeFile(path);
    if (!(await tryWriteExclusive(path, record))) {
      throw new HostAlreadyRunningError(await readLock(path));
    }
  } finally {
    const recovery = await readLock(recoveryPath);
    if (recovery?.token === record.token) await removeFile(recoveryPath);
  }
}

async function tryWriteExclusive(path: string, record: HostLockRecord): Promise<boolean> {
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
    await handle.writeFile(JSON.stringify(record), "utf8");
    return true;
  } catch (error) {
    if (isAlreadyExists(error)) return false;
    throw error;
  } finally {
    await handle?.close();
  }
}

async function removeFile(path: string): Promise<void> {
  await unlink(path).catch((error: unknown) => {
    if (!isMissingFile(error)) throw error;
  });
}

export async function readLock(path: string): Promise<HostLockRecord | null> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
  return LockRecordSchema.parse(JSON.parse(content) as unknown);
}

export function isProcessPresent(
  pid: number,
  signalProcess: (pid: number) => void = (value) => process.kill(value, 0),
): boolean {
  try {
    signalProcess(pid);
    return true;
  } catch (error) {
    if (isMissingProcess(error)) return false;
    if (error instanceof Error && "code" in error
      && (error as NodeJS.ErrnoException).code === "EPERM") return true;
    throw error;
  }
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error
    && (error as NodeJS.ErrnoException).code === "EEXIST";
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function isMissingProcess(error: unknown): boolean {
  return error instanceof Error && "code" in error
    && (error as NodeJS.ErrnoException).code === "ESRCH";
}
