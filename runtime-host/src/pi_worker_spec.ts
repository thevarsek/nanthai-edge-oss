import { fileURLToPath } from "node:url";
import type { OwnedProcessSpec } from "./process_tree.ts";
import type { PiWorkerConfig } from "./pi_worker_backend.ts";

export function piWorkerSpec(config: Omit<PiWorkerConfig, "environment">): OwnedProcessSpec {
  const bundled = import.meta.url.endsWith(".mjs");
  const entry = fileURLToPath(new URL(bundled ? "./pi_worker_entry.mjs" : "./pi_worker_entry.ts", import.meta.url));
  return { command: process.execPath, args: [
    ...(bundled ? [] : ["--import", "tsx"]), entry,
    Buffer.from(JSON.stringify(config)).toString("base64url"),
  ] };
}
