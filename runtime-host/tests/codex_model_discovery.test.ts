import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CodexModelDiscovery,
  CodexModelDiscoveryError,
} from "../src/codex_model_discovery.ts";

const fakeAppServer = fileURLToPath(
  new URL("./fixtures/fake_json_rpc_child.mjs", import.meta.url),
);

test("ephemeral Codex worker returns the existing canonical model descriptors", async () => {
  const discovery = new CodexModelDiscovery({
    codexCommand: process.execPath,
    codexArgs: [fakeAppServer],
    now: () => 1_786_752_000_000,
  });
  try {
    const models = await discovery.listModels({
      requestId: "discovery-1",
      adapterId: "codex",
      expiresAt: 1_786_752_120_000,
    }, new AbortController().signal);
    assert.deepEqual(models, [{
      provider: "openai",
      modelId: "gpt-test",
      displayName: "GPT Test",
      availability: "available",
      unavailableReason: null,
      inputModalities: ["text", "image"],
      supportsTools: true,
      supportsReasoning: true,
    }]);
  } finally {
    await discovery.shutdown();
  }
});

test("model discovery accepts an adapter identity, not a transport choice", async () => {
  const discovery = new CodexModelDiscovery({ codexCommand: process.execPath });
  await assert.rejects(
    discovery.listModels({
      requestId: "discovery-2",
      adapterId: "app_server_stdio",
      expiresAt: Date.now() + 1_000,
    }, new AbortController().signal),
    (error: unknown) => error instanceof CodexModelDiscoveryError
      && error.code === "adapter_not_supported",
  );
});
