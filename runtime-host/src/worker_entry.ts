import { verifyCodexVersion } from "./codex_executable.ts";
import readline from "node:readline";

import { CodexWorkerBackend, type CodexWorkerConfig } from "./codex_worker_backend.ts";
import { HostToWorkerMessageSchema } from "./protocol.ts";
import { WorkerController } from "./worker_controller.ts";
import { WorkerWireOutput } from "./worker_wire_output.ts";

const config = parseArgs(process.argv.slice(2));
const workerId = `worker-${process.pid}`;
const backend = new CodexWorkerBackend({ ...config, cliVersion: await verifyCodexVersion(config.codexCommand ?? "codex", config.codexArgs) });
const output = new WorkerWireOutput(workerId, (line) => process.stdout.write(`${line}\n`));
const controller = new WorkerController(backend, output, workerId);
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

controller.ready();
try {
  for await (const line of lines) {
    if (line.trim().length === 0) continue;
    const message = HostToWorkerMessageSchema.parse(JSON.parse(line) as unknown);
    if (await controller.handle(message)) break;
  }
} finally {
  lines.close();
  await controller.shutdown();
}

function parseArgs(args: string[]): CodexWorkerConfig {
  let transport: CodexWorkerConfig["transport"] | null = null;
  let codexCommand: string | undefined;
  let sandboxMode: CodexWorkerConfig["sandboxMode"];
  let workingDirectory: string | undefined;
  let threadName: string | undefined;
  let attachmentDirectory: string | undefined;
  const codexArgs: string[] = [];
  for (const argument of args) {
    if (argument === "--transport=sdk") throw new Error("SDK comparator is not a shipping worker");
    else if (argument === "--transport=app-server") transport = "app_server_stdio";
    else if (argument.startsWith("--codex-command=")) {
      codexCommand = argument.slice("--codex-command=".length);
    } else if (argument.startsWith("--codex-arg=")) {
      codexArgs.push(argument.slice("--codex-arg=".length));
    } else if (argument === "--sandbox=read-only") {
      sandboxMode = "read-only";
    } else if (argument === "--sandbox=workspace-write") {
      sandboxMode = "workspace-write";
    } else if (argument === "--sandbox=danger-full-access") {
      sandboxMode = "danger-full-access";
    } else if (argument.startsWith("--working-directory=")) {
      workingDirectory = argument.slice("--working-directory=".length);
    } else if (argument.startsWith("--thread-name-base64=")) {
      threadName = decodeThreadName(argument.slice("--thread-name-base64=".length));
    } else if (argument.startsWith("--attachment-directory-base64=")) {
      attachmentDirectory = decodePath(argument.slice("--attachment-directory-base64=".length));
    } else throw new Error(`Unknown worker argument: ${argument}`);
  }
  if (transport === null) throw new Error("Worker requires --transport=app-server");
  return {
    transport,
    ...(codexCommand === undefined ? {} : { codexCommand }),
    ...(codexArgs.length === 0 ? {} : { codexArgs }),
    ...(sandboxMode === undefined ? {} : { sandboxMode }),
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
    ...(threadName === undefined ? {} : { threadName }),
    ...(attachmentDirectory === undefined ? {} : { attachmentDirectory }),
  };
}

function decodePath(value: string): string {
  const decoded = decodeBase64Url(value);
  if (decoded.length === 0 || decoded.length > 4_096) throw new Error("Invalid attachment directory");
  return decoded;
}

function decodeThreadName(value: string): string {
  const decoded = decodeBase64Url(value);
  if (decoded.length === 0 || decoded.length > 512) {
    throw new Error("Invalid encoded thread name");
  }
  return decoded;
}

function decodeBase64Url(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid encoded worker argument");
  const decoded = Buffer.from(value, "base64url").toString("utf8");
  if (Buffer.from(decoded, "utf8").toString("base64url") !== value) {
    throw new Error("Invalid encoded worker argument");
  }
  return decoded;
}
