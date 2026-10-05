#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

const tsxCli = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));
const cliEntry = fileURLToPath(new URL("../src/cli_entry.ts", import.meta.url));
const child = spawn(process.execPath, [tsxCli, cliEntry, ...process.argv.slice(2)], {
  stdio: "inherit",
});

child.once("error", (error) => {
  process.stderr.write(`Could not start NanthAI CLI: ${error.message}\n`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal !== null) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
