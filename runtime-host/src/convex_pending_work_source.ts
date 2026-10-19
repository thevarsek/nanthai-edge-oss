import { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";

import type { HttpJsonClient } from "./http_json_client.ts";
import { PendingWorkWatch, type PendingWorkSource } from "./pending_work_watch.ts";

export type PendingWorkCredentialArgs = {
  deviceId: string;
  credentialId: string;
  credential: string;
  presenceSessionId: string;
};

const pendingWorkRef = makeFunctionReference<"query", PendingWorkCredentialArgs, unknown>(
  "runtime_host/host_watch:pendingWork",
);

export type CreatePendingWorkSource = (
  realtimeUrl: string,
  args: PendingWorkCredentialArgs,
) => PendingWorkSource;

/** Opens the Convex WebSocket that carries the host's pending-work subscription. */
export const createConvexPendingWorkSource: CreatePendingWorkSource = (realtimeUrl, args) => {
  const client = new ConvexClient(realtimeUrl, {
    unsavedChangesWarning: false,
    // The URL comes from the paired control plane, which may use a custom domain.
    skipConvexDeploymentUrlCheck: true,
  });
  return {
    subscribe: (onUpdate, onError) => {
      const unsubscribe = client.onUpdate(pendingWorkRef, args, onUpdate, onError);
      return () => unsubscribe();
    },
    onConnectionChange: (callback) =>
      client.subscribeToConnectionState((state) => callback(state.isWebSocketConnected)),
    isConnected: () => client.connectionState().isWebSocketConnected,
    close: () => client.close(),
  };
};

/**
 * The realtime URL receives the device credential, so it must be at least as
 * protected as the control plane: HTTPS, unless both are local development hosts.
 */
export function acceptedRealtimeUrl(controlPlaneUrl: string, realtimeUrl: string): string | null {
  let control: URL;
  let realtime: URL;
  try {
    control = new URL(controlPlaneUrl);
    realtime = new URL(realtimeUrl);
  } catch {
    return null;
  }
  if (realtime.username || realtime.password || realtime.search || realtime.hash) return null;
  if (realtime.protocol === "https:") return realtime.origin;
  const local = (url: URL) => ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  return realtime.protocol === "http:" && control.protocol === "http:" && local(control) && local(realtime)
    ? realtime.origin
    : null;
}

const RealtimeResponseSchema = z.object({ realtimeUrl: z.string().min(1) });

/**
 * Returns a live pending-work watch, or null when the control plane predates the
 * realtime endpoint or the URL is unacceptable. Callers then keep timed polling.
 */
export async function openPendingWorkWatch(
  client: HttpJsonClient,
  controlPlaneUrl: string,
  args: PendingWorkCredentialArgs,
  createSource: CreatePendingWorkSource,
  signal: AbortSignal,
): Promise<PendingWorkWatch | null> {
  let realtimeUrl: string | null;
  try {
    const response = await client.post("/runtime-host/v1/realtime", {}, RealtimeResponseSchema, {}, signal);
    realtimeUrl = acceptedRealtimeUrl(controlPlaneUrl, response.realtimeUrl);
  } catch (error) {
    if (signal.aborted) throw error;
    return null;
  }
  return realtimeUrl === null ? null : new PendingWorkWatch(createSource(realtimeUrl, args));
}
