import { fileURLToPath } from "node:url";

import type { OwnedProcessSpec } from "./process_tree.ts";

export type CodexWorkerSpecOptions = {
  codexCommand: string;
  codexArgs?: readonly string[];
  threadName: string;
  attachmentDirectory?: string;
  workingDirectory?: string;
  sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
};

export function codexAppServerWorkerSpec(options: CodexWorkerSpecOptions): OwnedProcessSpec {
  const bundled = import.meta.url.endsWith(".mjs");
  const workerEntry = fileURLToPath(new URL(bundled ? "./worker_entry.mjs" : "./worker_entry.ts", import.meta.url));
  const args = [
    ...(bundled ? [] : ["--import", "tsx"]),
    workerEntry,
    "--transport=app-server",
    `--codex-command=${options.codexCommand}`,
    `--sandbox=${options.sandboxMode}`,
    `--thread-name-base64=${Buffer.from(options.threadName, "utf8").toString("base64url")}`,
  ];
  for (const argument of options.codexArgs ?? []) args.push(`--codex-arg=${argument}`);
  if (options.attachmentDirectory !== undefined) {
    args.push(`--attachment-directory-base64=${encoded(options.attachmentDirectory)}`);
  }
  if (options.workingDirectory !== undefined) {
    args.push(`--working-directory=${options.workingDirectory}`);
  }
  return { command: process.execPath, args };
}

function encoded(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}
