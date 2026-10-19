import type {
  RuntimeModelDiscoveryCompletion,
  RuntimeModelDiscoveryRequest,
} from "./control_plane.ts";
import { HttpJsonClient } from "./http_json_client.ts";
import type { PollWaiter } from "./pending_work_watch.ts";
import {
  CompleteResponseSchema,
  ModelDiscoveryCompletionSchema,
  ModelDiscoveryPollResponseSchema,
} from "./http_runtime_contract.ts";

export async function* pollModelDiscovery(
  client: HttpJsonClient,
  headers: Readonly<Record<string, string>>,
  signal: AbortSignal,
  waiter: PollWaiter,
): AsyncIterable<RuntimeModelDiscoveryRequest> {
  while (!signal.aborted) {
    const ticket = waiter.begin();
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
      await waiter.wait(ticket, signal);
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
