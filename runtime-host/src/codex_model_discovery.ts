import { codexAppServerWorkerSpec } from "./codex_worker_spec.ts";
import type { RuntimeModelDiscoveryRequest } from "./control_plane.ts";
import { HostWireSequencer } from "./host_wire_sequencer.ts";
import type { AdapterModelDescriptor } from "./protocol.ts";
import { WireWorker } from "./wire_worker.ts";
import { piWorkerSpec } from "./pi_worker_spec.ts";
import type { PiWorkerConfig } from "./pi_worker_backend.ts";

export type CodexModelDiscoveryOptions = {
  codexCommand?: string;
  pi?: Omit<PiWorkerConfig, "environment">;
  codexArgs?: readonly string[];
  now?: () => number;
};

export class CodexModelDiscoveryError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "CodexModelDiscoveryError";
  }
}

export class RuntimeModelDiscovery {
  private readonly activeWorkers = new Set<WireWorker>();
  private readonly now: () => number;

  constructor(private readonly options: CodexModelDiscoveryOptions) {
    this.now = options.now ?? Date.now;
  }

  async listModels(
    request: RuntimeModelDiscoveryRequest,
    signal: AbortSignal,
  ): Promise<readonly AdapterModelDescriptor[]> {
    if (request.adapterId !== "codex" && request.adapterId !== "pi"
      || request.adapterId === "codex" && !this.options.codexCommand
      || request.adapterId === "pi" && !this.options.pi) {
      throw new CodexModelDiscoveryError(
        "adapter_not_supported",
        `Runtime Host does not provide adapter ${request.adapterId}`,
      );
    }
    if (signal.aborted) throw new CodexModelDiscoveryError("request_aborted", "Request aborted");

    const worker = WireWorker.spawn(request.adapterId === "pi" ? piWorkerSpec(this.options.pi!) : codexAppServerWorkerSpec({
      codexCommand: this.options.codexCommand!,
      ...(this.options.codexArgs === undefined ? {} : { codexArgs: this.options.codexArgs }),
      threadName: "NanthAI model discovery",
      sandboxMode: "read-only",
    }));
    this.activeWorkers.add(worker);
    const closeOnAbort = () => void worker.close().catch(() => undefined);
    signal.addEventListener("abort", closeOnAbort, { once: true });
    try {
      if (signal.aborted) closeOnAbort();
      const message = new HostWireSequencer(this.now).next(request.requestId, {
        kind: "list_models_request",
        payload: {},
      });
      worker.send(message);
      for await (const response of worker) {
        if (response.kind === "models_result"
          && response.payload.requestMessageId === message.messageId) {
          return response.payload.models;
        }
        if (response.kind === "protocol_error"
          && (response.payload.requestMessageId === message.messageId
            || response.payload.requestMessageId === null)) {
          throw new CodexModelDiscoveryError(
            "adapter_model_discovery_failed",
            response.payload.message,
          );
        }
      }
      throw new CodexModelDiscoveryError(
        "adapter_model_discovery_failed",
        "Runtime worker ended before returning its model list",
      );
    } finally {
      signal.removeEventListener("abort", closeOnAbort);
      this.activeWorkers.delete(worker);
      await worker.close();
    }
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled([...this.activeWorkers].map((worker) => worker.close()));
  }
}

export { RuntimeModelDiscovery as CodexModelDiscovery };
