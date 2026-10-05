import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";

export type ProcessTreeSupport =
  | { supported: true; mode: "posix_process_group" }
  | { supported: false; mode: "windows_job_object_required" };

export type OwnedProcessSpec = {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  processGroup?: "new" | "inherit";
};

export type ProcessExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

export class ProcessTreeUnsupportedError extends Error {
  constructor() {
    super("Windows worker ownership requires a Job Object implementation before release");
    this.name = "ProcessTreeUnsupportedError";
  }
}

export class ProcessTreeDrainError extends Error {
  constructor(readonly processGroupId: number) {
    super(`POSIX process group ${processGroupId} did not drain after SIGKILL`);
    this.name = "ProcessTreeDrainError";
  }
}

export function processTreeSupport(platform = process.platform): ProcessTreeSupport {
  if (platform === "win32") {
    return { supported: false, mode: "windows_job_object_required" };
  }
  return { supported: true, mode: "posix_process_group" };
}

export class OwnedProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly exit: Promise<ProcessExit>;

  private readonly ownedPid: number | undefined;
  private settled = false;
  private termination: Promise<ProcessExit> | null = null;

  private constructor(
    child: ChildProcessWithoutNullStreams,
    private readonly processGroup: "new" | "inherit",
  ) {
    this.child = child;
    this.ownedPid = child.pid;
    this.exit = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        this.settled = true;
        resolve({ code, signal });
      });
    });
  }

  static spawn(spec: OwnedProcessSpec): OwnedProcess {
    const support = processTreeSupport();
    if (!support.supported) {
      throw new ProcessTreeUnsupportedError();
    }
    const options: SpawnOptionsWithoutStdio = {
      detached: spec.processGroup !== "inherit",
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    };
    if (spec.cwd !== undefined) {
      options.cwd = spec.cwd;
    }
    if (spec.env !== undefined) {
      options.env = spec.env;
    }
    const child = spawn(spec.command, spec.args ?? [], options);
    return new OwnedProcess(child, spec.processGroup ?? "new");
  }

  get pid(): number {
    if (this.ownedPid === undefined) {
      throw new Error("Owned process did not receive a PID");
    }
    return this.ownedPid;
  }

  terminate(graceMs = 500): Promise<ProcessExit> {
    if (this.termination === null) {
      this.termination = this.terminateOnce(graceMs);
    }
    return this.termination;
  }

  private async terminateOnce(graceMs: number): Promise<ProcessExit> {
    if (this.processGroup === "inherit") {
      return this.terminateDirectChild(graceMs);
    }

    this.signalGroup("SIGTERM");
    if (!(await this.waitForGroupDrain(graceMs))) {
      this.signalGroup("SIGKILL");
      const killDrainMs = Math.max(graceMs, 500);
      if (!(await this.waitForGroupDrain(killDrainMs))) {
        throw new ProcessTreeDrainError(this.pid);
      }
    }
    return this.exit;
  }

  private async terminateDirectChild(graceMs: number): Promise<ProcessExit> {
    if (this.settled) return this.exit;
    this.signalGroup("SIGTERM");
    const graceful = await this.waitForExit(graceMs);
    if (graceful !== null) {
      return graceful;
    }
    this.signalGroup("SIGKILL");
    return this.exit;
  }

  private signalGroup(signal: NodeJS.Signals): void {
    try {
      if (this.processGroup === "new") {
        process.kill(-this.pid, signal);
      } else {
        this.child.kill(signal);
      }
    } catch (error) {
      if (!isMissingProcess(error)) {
        throw error;
      }
    }
  }

  private async waitForExit(timeoutMs: number): Promise<ProcessExit | null> {
    let timeout: NodeJS.Timeout | undefined;
    const timedOut = new Promise<null>((resolve) => {
      timeout = setTimeout(() => resolve(null), timeoutMs);
      timeout.unref();
    });
    const result = await Promise.race([this.exit, timedOut]);
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    return result;
  }

  private async waitForGroupDrain(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (this.processGroupExists()) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      await delay(Math.min(10, remaining));
    }
    return true;
  }

  private processGroupExists(): boolean {
    try {
      process.kill(-this.pid, 0);
      return true;
    } catch (error) {
      if (isMissingProcess(error)) return false;
      if (isPermissionDenied(error)) return true;
      throw error;
    }
  }
}

function isMissingProcess(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ESRCH"
  );
}

function isPermissionDenied(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EPERM"
  );
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
