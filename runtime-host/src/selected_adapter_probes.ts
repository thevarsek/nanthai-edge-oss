import type { AdapterRegistry } from "./adapter_registry.ts";

/** One unavailable selection must not prevent another adapter from registering. */
export async function probeSelectedAdapters(registry: AdapterRegistry, environment: NodeJS.ProcessEnv) {
  const selected = registry.list().filter(adapter => adapter.name === "codex"
    ? environment.NANTHAI_CODEX_COMMAND?.trim() : environment.NANTHAI_PI_COMMAND?.trim());
  if (!selected.length) throw new Error("Select an installed Codex or Pi executable in setup");
  const results = await Promise.allSettled(selected.map(adapter => registry.probe(adapter.name)));
  const probes = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  if (!probes.length) {
    throw new Error(results.map((result, index) => `${selected[index]!.name}: ${result.status === "rejected"
      ? String(result.reason instanceof Error ? result.reason.message : result.reason) : "Unavailable"}`).join("\n"));
  }
  return probes;
}
