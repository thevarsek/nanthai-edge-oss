#!/usr/bin/env node

import { runCli } from "./cli.ts";
import { defaultCliDependencies } from "./cli_dependencies.ts";
import { InMemoryCredentialStore } from "./credential_store.ts";
import { DeviceCredentialSchema } from "./macos_keychain_store.ts";
import { watchTrayParent } from "./tray_parent_watch.ts";

const shutdown = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => shutdown.abort());
}

const stopWatching = watchTrayParent(process.argv.slice(2), process.env, shutdown);
async function readInput(): Promise<string> {
  let data = "";
  for await (const chunk of process.stdin) data += String(chunk);
  return data;
}
const appRequest = process.env.NANTHAI_APP_REQUEST_STDIN === "1"
  ? JSON.parse(await readInput()) as { credential: unknown; input?: string } : null;
// Clear the transport marker before any native worker is started.
delete process.env.NANTHAI_APP_REQUEST_STDIN;
const credentials = appRequest ? new InMemoryCredentialStore(appRequest.credential === null
  ? null : DeviceCredentialSchema.parse(appRequest.credential)) : undefined;
const dependencies = defaultCliDependencies(shutdown.signal, credentials);
const exitCode = await runCli(process.argv.slice(2), {
  ...dependencies, stdin: appRequest ? async () => appRequest.input ?? "" : readInput,
});
stopWatching();
process.exitCode = exitCode;
