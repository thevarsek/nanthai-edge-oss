import { setTimeout } from "node:timers/promises";
import { hostname } from "node:os";

import type { AdapterName, AdapterRegistry } from "./adapter_registry.ts";
import type {
  DeviceCredential,
  HostRegistration,
  PairingClient,
} from "./control_plane.ts";
import type { CredentialStore } from "./credential_store.ts";
import type { HostStatus } from "./host_status_store.ts";
import type { UsageReader } from "./usage_history.ts";

export interface RunnableHost {
  run(signal?: AbortSignal): Promise<void>;
}

export interface RuntimeHostFactory {
  create(credential: DeviceCredential, owner: HostRegistration["owner"]): RunnableHost;
}

export interface RuntimeStatusReader {
  read(): Promise<HostStatus | null>;
  removeIfOwnedBy(pid: number): Promise<void>;
}

export type CliDependencies = {
  savedWork?: {
    list(): Promise<unknown>;
    control?(taskId: string, input: unknown): Promise<unknown>;
    continue(taskId: string, prompt: string, signal: AbortSignal): Promise<unknown>;
    sync(signal?: AbortSignal): Promise<number>;
  };
  credentials: CredentialStore;
  pairing: PairingClient;
  adapters: AdapterRegistry;
  status: RuntimeStatusReader;
  usage: UsageReader;
  hostFactory: RuntimeHostFactory;
  signalProcess: (pid: number, signal: NodeJS.Signals) => void;
  processExists: (pid: number) => boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  shutdownSignal?: AbortSignal;
  stdin?: () => Promise<string>;
};

export async function runCli(args: readonly string[], dependencies: CliDependencies) {
  try {
    return await dispatch(args, dependencies);
  } catch (error) {
    dependencies.stderr(publicError(error));
    return 1;
  }
}

async function dispatch(args: readonly string[], dependencies: CliDependencies) {
  const [command, subcommand, name] = args;
  if (command === undefined || command === "help" || command === "--help") {
    dependencies.stdout(helpText());
    return 0;
  }
  switch (command) {
    case "saved": {
      if (!dependencies.savedWork) throw new Error("Saved tasks are unavailable in this build");
      if (subcommand === "list") dependencies.stdout(JSON.stringify(await dependencies.savedWork.list()));
      else if (subcommand === "continue" && name && args[3]) {
        await dependencies.savedWork.continue(name, args[3], dependencies.shutdownSignal ?? new AbortController().signal);
        dependencies.stdout(JSON.stringify({ completed: true }));
      } else if (subcommand === "control" && name && dependencies.savedWork.control && dependencies.stdin) {
        dependencies.stdout(JSON.stringify(await dependencies.savedWork.control(name, JSON.parse(await dependencies.stdin()) as unknown)));
      } else if (subcommand === "sync") dependencies.stdout(JSON.stringify({ synchronized: await dependencies.savedWork.sync(dependencies.shutdownSignal) }));
      else throw new Error("Usage: nanthai saved list | continue <task-id> <follow-up> | sync");
      return 0;
    }
    case "pair": return pair(subcommand, name, dependencies, args.slice(3));
    case "pair-code": return pair(undefined, subcommand, dependencies, args.slice(2), true);
    case "unpair": {
      const status = await dependencies.status.read();
      if (status && dependencies.processExists(status.pid)) throw new Error("Stop the runtime before removing its local pairing credential.");
      await dependencies.credentials.deleteDeviceCredential();
      dependencies.stdout("Local device credential removed. Canonical results remain in NanthAI. Revoke the device in NanthAI settings if retiring this machine.");
      return 0;
    }
    case "runtime": return runtime(subcommand, dependencies, name === "--wait", args.slice(2));
    case "doctor": return doctor(dependencies);
    case "adapters": return adapters(subcommand, name, dependencies);
    case "usage": return usage(subcommand, dependencies);
    default: throw new Error(`Unknown command: ${command}`);
  }
}

async function usage(month: string | undefined, dependencies: CliDependencies) {
  if (month !== undefined && !/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("Usage: nanthai usage [YYYY-MM]");
  }
  dependencies.stdout(JSON.stringify(await dependencies.usage.list(month)));
  return 0;
}

async function pair(
  pairingId: string | undefined,
  oneTimeCode: string | undefined,
  dependencies: CliDependencies,
  options: readonly string[] = [],
  shortCode = false,
) {
  if ((!shortCode && (pairingId === undefined || pairingId.trim().length === 0))
    || oneTimeCode === undefined || oneTimeCode.trim().length === 0) {
    throw new Error("Usage: nanthai pair <pairing-id> <one-time-code>");
  }
  if (options.length && (options.length !== 2 || options[0] !== "--server")) {
    throw new Error("Usage: nanthai pair <pairing-id> <one-time-code> [--server <URL>]");
  }
  const controlPlaneUrl = options[1];
  if (controlPlaneUrl) {
    const url = new URL(controlPlaneUrl);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error("The pairing server must be an HTTP(S) origin without credentials, query or fragment.");
    }
  }
  const credential = await dependencies.pairing.pair({
    ...(shortCode ? { shortCode: true as const } : { pairingId: pairingId ?? "" }),
    oneTimeCode,
    hostname: hostname(),
    platform: process.platform,
    architecture: process.arch,
    ...(controlPlaneUrl ? { controlPlaneUrl } : {}),
  });
  await dependencies.credentials.writeDeviceCredential(credential);
  dependencies.stdout(JSON.stringify({ paired: true, deviceId: credential.deviceId }));
  return 0;
}

async function runtime(
  subcommand: string | undefined,
  dependencies: CliDependencies,
  waitForExit = false,
  options: readonly string[] = [],
) {
  switch (subcommand) {
    case "start": {
      const owner = options[0] === "--owner" && options[1] === "tray" ? "tray" : "foreground_cli";
      const credential = await requireCredential(dependencies.credentials);
      dependencies.stdout(JSON.stringify({
        state: "starting",
        deviceId: credential.deviceId,
        owner,
      }));
      await dependencies.hostFactory.create(credential, owner)
        .run(dependencies.shutdownSignal);
      return 0;
    }
    case "status": {
      const [credential, status] = await Promise.all([
        dependencies.credentials.readDeviceCredential(),
        dependencies.status.read(),
      ]);
      const current = status !== null && dependencies.processExists(status.pid)
        ? status : null;
      if (status !== null && current === null) {
        await dependencies.status.removeIfOwnedBy(status.pid);
      }
      dependencies.stdout(JSON.stringify(current ?? {
        state: "offline",
        paired: credential !== null,
        deviceId: credential?.deviceId ?? null,
      }));
      return 0;
    }
    case "stop": {
      const status = await dependencies.status.read();
      if (status === null) {
        dependencies.stdout(JSON.stringify({ state: "offline", stopped: false }));
        return 0;
      }
      if (!dependencies.processExists(status.pid)) {
        await dependencies.status.removeIfOwnedBy(status.pid);
        dependencies.stdout(JSON.stringify({ state: "offline", stopped: false }));
        return 0;
      }
      try {
        dependencies.signalProcess(status.pid, "SIGTERM");
      } catch (error) {
        if (!isMissingProcess(error)) throw error;
        await dependencies.status.removeIfOwnedBy(status.pid);
      }
      if (waitForExit) {
        const deadline = Date.now() + 15_000;
        while (dependencies.processExists(status.pid) && Date.now() < deadline) await setTimeout(100);
        if (dependencies.processExists(status.pid)) throw new Error("Runtime is still stopping; retry uninstall after it exits.");
        await dependencies.status.removeIfOwnedBy(status.pid);
      }
      dependencies.stdout(JSON.stringify({ state: waitForExit ? "offline" : "stopping", pid: status.pid }));
      return 0;
    }
    default: throw new Error("Usage: nanthai runtime start|status|stop");
  }
}

async function doctor(dependencies: CliDependencies) {
  const [credential, status, probes] = await Promise.all([
    dependencies.credentials.readDeviceCredential(),
    dependencies.status.read(),
    Promise.allSettled(dependencies.adapters.list().map(adapter => dependencies.adapters.probe(adapter.name))),
  ]);
  const current = status !== null && dependencies.processExists(status.pid) ? status : null;
  if (status !== null && current === null) {
    await dependencies.status.removeIfOwnedBy(status.pid);
  }
  dependencies.stdout(JSON.stringify({
    platform: process.platform,
    architecture: process.arch,
    pairing: credential === null
      ? { paired: false, deviceId: null }
      : { paired: true, deviceId: credential.deviceId },
    runtime: current ?? { state: "offline" },
    adapters: Object.fromEntries(dependencies.adapters.list().map((adapter, index) => {
      const result = probes[index];
      return [adapter.name, result?.status === "fulfilled" ? result.value : { healthy: false, summary: "Executable or configuration unavailable" }];
    })),
  }));
  return credential !== null && probes.some(probe => probe.status === "fulfilled" && probe.value.healthy) ? 0 : 2;
}

async function adapters(
  subcommand: string | undefined,
  name: string | undefined,
  dependencies: CliDependencies,
) {
  if (subcommand === "list") {
    dependencies.stdout(JSON.stringify(dependencies.adapters.list()));
    return 0;
  }
  const adapter = parseAdapterName(name);
  const probe = await dependencies.adapters.probe(adapter);
  if (subcommand === "probe") {
    dependencies.stdout(JSON.stringify(probe));
    return probe.healthy ? 0 : 2;
  }
  if (subcommand === "account") {
    dependencies.stdout(JSON.stringify({
      adapter: probe.adapter,
      account: probe.account,
      rateLimits: probe.rateLimits,
      rateLimitReadError: probe.rateLimitReadError,
    }));
    return probe.account.authMethod === "signed_out" ? 2 : 0;
  }
  throw new Error("Usage: nanthai adapters list|probe codex|pi|account codex|pi");
}

function parseAdapterName(value: string | undefined): AdapterName {
  if (value !== "codex" && value !== "pi") throw new Error("Choose codex or pi");
  return value;
}

async function requireCredential(store: CredentialStore): Promise<DeviceCredential> {
  const credential = await store.readDeviceCredential();
  if (credential === null) throw new Error("This machine is not paired; run nanthai pair first");
  return credential;
}

function isMissingProcess(error: unknown): boolean {
  return error instanceof Error && "code" in error
    && (error as NodeJS.ErrnoException).code === "ESRCH";
}

function publicError(error: unknown): string {
  return error instanceof Error ? error.message : "NanthAI CLI command failed";
}

function helpText(): string {
  return [
    "NanthAI Runtime Host",
    "  nanthai pair <pairing-id> <one-time-code> [--server <URL>]",
    "  nanthai pair-code <code> [--server <URL>]",
    "  nanthai unpair",
    "  nanthai runtime start|status|stop",
    "  nanthai doctor",
    "  nanthai usage [YYYY-MM]",
    "  nanthai adapters list",
    "  nanthai adapters probe codex",
    "  nanthai adapters account codex",
  ].join("\n");
}
