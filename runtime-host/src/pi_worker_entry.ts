import { z } from "zod";
import { PiWorkerBackend } from "./pi_worker_backend.ts";
import { verifyPiVersion } from "./pi_operator.ts";
import { HostToWorkerMessageSchema } from "./protocol.ts";
import { WorkerController } from "./worker_controller.ts";
import { WorkerWireOutput } from "./worker_wire_output.ts";

const config = z.object({
  command: z.string().min(1), args: z.array(z.string()).optional(),
  sessionDirectory: z.string().min(1), workingDirectory: z.string().optional(),
  attachmentDirectory: z.string().optional(), threadName: z.string().max(512).optional(),
}).parse(JSON.parse(Buffer.from(process.argv[2] ?? "", "base64url").toString("utf8")));
const id = `worker-${process.pid}`;
const backend = new PiWorkerBackend({ ...config, cliVersion: await verifyPiVersion(config.command, config.args) });
const controller = new WorkerController(backend, new WorkerWireOutput(id, line => process.stdout.write(`${line}\n`)), id);
controller.ready();
let buffer = "";
try {
  process.stdin.setEncoding("utf8");
  outer: for await (const chunk of process.stdin) {
    buffer += String(chunk);
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      const message = HostToWorkerMessageSchema.parse(JSON.parse(line));
      if (await controller.handle(message)) break outer;
    }
    if (Buffer.byteLength(buffer) > 16 * 1024 * 1024) throw new Error("Pi worker input exceeded wire capacity");
  }
} finally { await controller.shutdown(); }
