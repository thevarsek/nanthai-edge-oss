import test from "node:test";
import assert from "node:assert/strict";
import { probeSelectedAdapters } from "../src/selected_adapter_probes.ts";
import type { AdapterRegistry } from "../src/adapter_registry.ts";

test("failed Codex selection keeps Pi; failed Pi keeps Codex; both failed report exact causes", async () => {
  const failures = new Set<string>();
  const registry: AdapterRegistry = {
    list: () => [{ name: "codex", implementation: "codex_app_server", selected: true, transport: "stdio" },
      { name: "pi", implementation: "pi_rpc", selected: true, transport: "stdio" }],
    probe: async name => {
      if (failures.has(name)) throw new Error(`${name} version could not be read`);
      return { healthy: true, adapter: "pi_rpc", transport: "stdio", cliVersion: "1.0.0", protocolVersion: "rpc",
        command: name, modelCount: 1, account: { authMethod: "configured", identity: null, plan: null,
          requiresOpenaiAuth: false }, rateLimits: null, rateLimitReadError: null };
    },
  };
  const environment = { NANTHAI_CODEX_COMMAND: "/codex", NANTHAI_PI_COMMAND: "/pi" };
  failures.add("codex");
  assert.deepEqual((await probeSelectedAdapters(registry, environment)).map(item => item.command), ["pi"]);
  failures.clear(); failures.add("pi");
  assert.deepEqual((await probeSelectedAdapters(registry, environment)).map(item => item.command), ["codex"]);
  failures.add("codex");
  await assert.rejects(probeSelectedAdapters(registry, environment), /codex version could not be read.*\npi: pi version could not be read/);
  await assert.rejects(probeSelectedAdapters(registry, {}), /Select an installed/);
});
