import { join } from "node:path";
import { CanonicalUsageHistory } from "./canonical_usage_history.ts";
import { resultBridge } from "./result_bridge.ts";
import { randomUUID } from "node:crypto";

import { LocalAdapterRegistry } from "./adapter_registry.ts";
import { probeSelectedAdapters } from "./selected_adapter_probes.ts";
import { canonicalCodexCapabilities } from "./canonical_capabilities.ts";
import type { RuntimeHostFactory, RunnableHost } from "./cli.ts";
import { APP_SERVER_CAPABILITIES } from "./codex_capabilities.ts";
import { RuntimeWorkerExecutor } from "./codex_command_executor.ts";
import { RuntimeModelDiscovery } from "./codex_model_discovery.ts";
import { PI_CAPABILITIES } from "./pi_worker_backend.ts";
import type {
  DeviceCredential,
  HostRegistration,
  HostAdapterPresence,
} from "./control_plane.ts";
import { HostStatusStore } from "./host_status_store.ts";
import { HttpPairingClient } from "./http_pairing_client.ts";
import { createConvexPendingWorkSource } from "./convex_pending_work_source.ts";
import { HttpRuntimeControlPlane } from "./http_runtime_transport.ts";
import { HttpRuntimePartFetcher } from "./runtime_part_fetcher.ts";
import { MacOSKeychainCredentialStore } from "./macos_keychain_store.ts";
import { FileOutboundSpool } from "./outbound_spool.ts";
import { ForegroundRuntimeHost } from "./runtime_host.ts";
import { runtimePaths } from "./runtime_paths.ts";
import { checkpointExecutor } from "./checkpoint_executor.ts";
import { SavedWorkService, savedWorkOptions } from "./saved_work_service.ts";
import { BridgeRequestSchema, PublishResultSchema } from "./protocol.ts";
import { syncSavedResults } from "./saved_task_sync.ts";
import { SavedTaskStore, type SavedTask } from "./saved_task_store.ts";
import { UsageHistory } from "./usage_history.ts";

const HOST_VERSION = "0.4.1";

export function defaultCliDependencies(shutdownSignal?: AbortSignal) {
  if (process.platform !== "darwin") {
    throw new Error("This M45 release slice supports macOS Runtime Hosts only");
  }
  const paths = runtimePaths();
  const adapters = new LocalAdapterRegistry();
  const controlPlaneUrl = process.env.NANTHAI_CONTROL_PLANE_URL?.trim();
  return {
    savedWork: new SavedWorkService(new SavedTaskStore(join(paths.root, "saved-work")),
      new MacOSKeychainCredentialStore(), savedWorkOptions(paths.root)),
    credentials: new MacOSKeychainCredentialStore(),
    pairing: new HttpPairingClient({ controlPlaneUrl: controlPlaneUrl ?? "", hostVersion: HOST_VERSION }),
    adapters,
    status: new HostStatusStore(paths.hostStatus),
    usage: new CanonicalUsageHistory(new MacOSKeychainCredentialStore(), join(paths.root, "canonical-usage")),
    hostFactory: new ProductionRuntimeHostFactory(adapters),
    signalProcess: (pid: number, signal: NodeJS.Signals) => process.kill(pid, signal),
    processExists: isProcessPresent,
    stdout: (line: string) => process.stdout.write(`${line}\n`),
    stderr: (line: string) => process.stderr.write(`${line}\n`),
    ...(shutdownSignal === undefined ? {} : { shutdownSignal }),
  };
}

function isProcessPresent(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error
      && (error as NodeJS.ErrnoException).code === "ESRCH") return false;
    if (error instanceof Error && "code" in error
      && (error as NodeJS.ErrnoException).code === "EPERM") return true;
    throw error;
  }
}

export class ProductionRuntimeHostFactory implements RuntimeHostFactory {
  constructor(private readonly adapters: LocalAdapterRegistry) {}

  create(
    credential: DeviceCredential,
    owner: HostRegistration["owner"],
  ): RunnableHost {
    return {
      run: async (signal) => {
        const paths = runtimePaths();
        const probes = await probeSelectedAdapters(this.adapters, process.env);
        const codex = probes.find(probe => probe.adapter === "codex_app_server");
        const pi = probes.find(probe => probe.adapter === "pi_rpc");
        const adapters: HostAdapterPresence[] = probes.map(probe => {
          const capabilities = { nanthaiSourceCitations: true, ...(probe.adapter === "pi_rpc" ? PI_CAPABILITIES : canonicalCodexCapabilities(APP_SERVER_CAPABILITIES)), adapterVersion: probe.cliVersion };
          return { adapterId: capabilities.adapterId, adapterVersion: probe.cliVersion,
            authState: probe.healthy && probe.account.authMethod !== "signed_out" ? "ready" : "signed_out", capabilities };
        });
        const executables = {
          ...(codex ? { codexCommand: codex.command } : {}),
          ...(pi ? { pi: { command: pi.command, sessionDirectory: join(paths.root, "pi-sessions"),
            ...(process.env.NANTHAI_PI_WORKING_DIRECTORY?.trim() ? { workingDirectory: process.env.NANTHAI_PI_WORKING_DIRECTORY.trim() } : {}),
          } } : {}),
        };
        const usage = new UsageHistory(paths.usageHistory);
        const savedTasks = new SavedTaskStore(join(paths.root, "saved-work"));
        const tasks = new Map<string, SavedTask>();
        const presenceSessionId = randomUUID();
        const bridge = resultBridge(credential, presenceSessionId);
        let syncing: Promise<void> | null = null;
        const synchronize = (signal: AbortSignal) => {
          syncing ??= syncSavedResults(savedTasks, credential, signal).then(() => undefined)
            .catch(error => { process.stderr.write(`[NanthAI saved work] ${String(error)}\n`); })
            .finally(() => { syncing = null; });
          return syncing;
        };
        const host = new ForegroundRuntimeHost(
          credential,
          new HttpRuntimeControlPlane({
            createPresenceSessionId: () => presenceSessionId,
            pendingWorkSource: createConvexPendingWorkSource,
          }),
          new FileOutboundSpool(paths.eventSpool),
          new HostStatusStore(paths.hostStatus),
          checkpointExecutor(new RuntimeWorkerExecutor({
            ...executables,
            onPreparedTurn: async (command, directory) => {
              try { tasks.set(command.attemptId, await savedTasks.capture(command, credential.deviceId, credential.controlPlaneUrl, directory)); }
              catch (error) { process.stderr.write(`[NanthAI checkpoint] ${String(error)}\n`); }
            },
            bridgeCall: async (value, packet, bridgeSignal) => {
              const request = BridgeRequestSchema.parse(value);
              const task = tasks.get(packet.attemptId);
              if (task && request.tool === "nanthai_publish_result") {
                const file = PublishResultSchema.parse(request.arguments);
                const existing = task.files.find(item => item.callId === request.callId);
                if (!existing) { task.files.push({ ...file, callId: request.callId }); await savedTasks.saveTask(task); }
              }
              return bridge(value, packet, bridgeSignal);
            },
            partFetcher: new HttpRuntimePartFetcher(credential, { presenceSessionId }),
          }, usage), savedTasks, tasks),
          {
            onConnected: synchronize,
            onHeartbeat: async signal => { void synchronize(signal); },
            lockPath: paths.hostLock,
            owner,
            hostVersion: HOST_VERSION,
            adapters,
            modelDiscovery: new RuntimeModelDiscovery(executables),
          },
        );
        await host.run(signal);
      },
    };
  }
}
