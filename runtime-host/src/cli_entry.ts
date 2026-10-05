#!/usr/bin/env node

import { runCli } from "./cli.ts";
import { defaultCliDependencies } from "./cli_dependencies.ts";
import { watchTrayParent } from "./tray_parent_watch.ts";

const shutdown = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => shutdown.abort());
}

const stopWatching = watchTrayParent(process.argv.slice(2), process.env, shutdown);
const exitCode = await runCli(
  process.argv.slice(2),
  { ...defaultCliDependencies(shutdown.signal), stdin: async () => {
    let data = "";
    for await (const chunk of process.stdin) data += String(chunk);
    return data;
  } },
);
stopWatching();
process.exitCode = exitCode;
