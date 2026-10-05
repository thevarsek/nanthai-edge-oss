import assert from "node:assert/strict";
import test from "node:test";

import { CodexModelDiscoveryError } from "../src/codex_model_discovery.ts";
import { InMemoryControlPlane } from "../src/control_plane.ts";
import type { AdapterModelDescriptor } from "../src/protocol.ts";
import {
  runRuntimeModelDiscovery,
  type RuntimeModelDiscoveryExecutor,
} from "../src/runtime_model_discovery.ts";

const model: AdapterModelDescriptor = {
  provider: "openai",
  modelId: "gpt-test",
  displayName: "GPT Test",
  availability: "available",
  unavailableReason: null,
  inputModalities: ["text"],
  supportsTools: true,
  supportsReasoning: true,
};

test("discovery completes one live request without retaining a local catalog", async () => {
  const controlPlane = new InMemoryControlPlane();
  const executor = new FakeDiscoveryExecutor();
  controlPlane.enqueueModelDiscovery(request("discovery-1"));
  controlPlane.endModelDiscoveryRequests();

  await runRuntimeModelDiscovery(
    controlPlane, executor, new AbortController().signal,
    (error) => assert.fail(error.message), () => 1_000,
  );

  assert.deepEqual(executor.requestIds, ["discovery-1"]);
  assert.deepEqual(controlPlane.modelDiscoveryCompletions, [{
    requestId: "discovery-1", status: "completed", models: [model],
  }]);
});

test("adapter failure becomes a failed request and does not fail the host lane", async () => {
  const controlPlane = new InMemoryControlPlane();
  const executor = new FakeDiscoveryExecutor(new CodexModelDiscoveryError(
    "adapter_model_discovery_failed",
    "Codex account is signed out",
  ));
  const controlPlaneFailures: Error[] = [];
  controlPlane.enqueueModelDiscovery(request("discovery-2"));
  controlPlane.endModelDiscoveryRequests();

  await runRuntimeModelDiscovery(
    controlPlane, executor, new AbortController().signal,
    (error) => controlPlaneFailures.push(error), () => 1_000,
  );

  assert.deepEqual(controlPlaneFailures, []);
  assert.deepEqual(controlPlane.modelDiscoveryCompletions, [{
    requestId: "discovery-2",
    status: "failed",
    errorCode: "adapter_model_discovery_failed",
    errorMessage: "Codex account is signed out",
  }]);
});

class FakeDiscoveryExecutor implements RuntimeModelDiscoveryExecutor {
  readonly requestIds: string[] = [];

  constructor(private readonly failure: Error | null = null) {}

  async listModels(requestValue: { requestId: string }): Promise<readonly AdapterModelDescriptor[]> {
    this.requestIds.push(requestValue.requestId);
    if (this.failure !== null) throw this.failure;
    return [model];
  }

  async shutdown(): Promise<void> {}
}

function request(requestId: string) {
  return { requestId, adapterId: "codex", expiresAt: 2_000 };
}
