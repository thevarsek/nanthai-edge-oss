import type {
  RuntimeModelDiscoveryCompletion,
  RuntimeModelDiscoveryRequest,
} from "./control_plane.ts";
import { HttpJsonClient } from "./http_json_client.ts";
import {
  CompleteResponseSchema,
  ModelDiscoveryCompletionSchema,
  ModelDiscoveryPollResponseSchema,
} from "./http_runtime_contract.ts";

export async function* pollModelDiscovery(
  client: HttpJsonClient,
  headers: Readonly<Record<string, string>>,
  signal: AbortSignal,
  pollIntervalMs: number,
  delay: (milliseconds: number, signal: AbortSignal) => Promise<void>,
): AsyncIterable<RuntimeModelDiscoveryRequest> {
  while (!signal.aborted) {
    try {
      const response = await client.post(
        "/runtime-host/v1/model-discovery/poll",
        {},
        ModelDiscoveryPollResponseSchema,
        headers,
        signal,
      );
      for (const request of response.requests) {
        if (signal.aborted) return;
        yield request;
      }
      await delay(pollIntervalMs, signal);
    } catch (error) {
      if (signal.aborted) return;
      throw error;
    }
  }
}

export async function completeModelDiscovery(
  client: HttpJsonClient,
  headers: Readonly<Record<string, string>>,
  signal: AbortSignal,
  result: RuntimeModelDiscoveryCompletion,
): Promise<void> {
  await client.post(
    "/runtime-host/v1/model-discovery/complete",
    ModelDiscoveryCompletionSchema.parse(result),
    CompleteResponseSchema,
    headers,
    signal,
  );
}
