import { CodexModelDiscoveryError } from "./codex_model_discovery.ts";
import type {
  ControlPlaneConnection,
  RuntimeModelDiscoveryCompletion,
  RuntimeModelDiscoveryRequest,
} from "./control_plane.ts";
import type { AdapterModelDescriptor } from "./protocol.ts";

export interface RuntimeModelDiscoveryExecutor {
  listModels(
    request: RuntimeModelDiscoveryRequest,
    signal: AbortSignal,
  ): Promise<readonly AdapterModelDescriptor[]>;
  shutdown(): Promise<void>;
}

export async function runRuntimeModelDiscovery(
  connection: ControlPlaneConnection,
  executor: RuntimeModelDiscoveryExecutor,
  signal: AbortSignal,
  onControlPlaneFailure: (error: Error) => void,
  now: () => number = Date.now,
): Promise<void> {
  const active = new Set<Promise<void>>();
  try {
    for await (const request of connection.modelDiscoveryRequests()) {
      if (signal.aborted) break;
      const task = handleRequest(connection, executor, request, signal, now);
      active.add(task);
      void task.then(
        () => active.delete(task),
        (error: unknown) => {
          active.delete(task);
          if (!signal.aborted) onControlPlaneFailure(asError(error));
        },
      );
    }
  } finally {
    await Promise.allSettled([...active]);
  }
}

async function handleRequest(
  connection: ControlPlaneConnection,
  executor: RuntimeModelDiscoveryExecutor,
  request: RuntimeModelDiscoveryRequest,
  hostSignal: AbortSignal,
  now: () => number,
): Promise<void> {
  let result: RuntimeModelDiscoveryCompletion;
  const remainingMs = request.expiresAt - now();
  if (remainingMs <= 0) {
    result = expired(request.requestId);
  } else {
    const requestAbort = new AbortController();
    const abortWithHost = () => requestAbort.abort();
    hostSignal.addEventListener("abort", abortWithHost, { once: true });
    const timeout = setTimeout(() => requestAbort.abort(), remainingMs);
    timeout.unref();
    try {
      const models = await executor.listModels(request, requestAbort.signal);
      result = requestAbort.signal.aborted
        ? expired(request.requestId)
        : { requestId: request.requestId, status: "completed", models };
    } catch (error) {
      result = requestAbort.signal.aborted
        ? expired(request.requestId)
        : failed(request.requestId, error);
    } finally {
      clearTimeout(timeout);
      hostSignal.removeEventListener("abort", abortWithHost);
    }
  }
  if (!hostSignal.aborted) await connection.completeModelDiscovery(result);
}

function expired(requestId: string): RuntimeModelDiscoveryCompletion {
  return {
    requestId,
    status: "failed",
    errorCode: "model_discovery_expired",
    errorMessage: "Model discovery expired before the Runtime Host could complete it",
  };
}

function failed(requestId: string, error: unknown): RuntimeModelDiscoveryCompletion {
  const detail = asError(error);
  return {
    requestId,
    status: "failed",
    errorCode: error instanceof CodexModelDiscoveryError
      ? error.code
      : "model_discovery_failed",
    errorMessage: (detail.message.trim() || "Model discovery failed").slice(0, 2_000),
  };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
