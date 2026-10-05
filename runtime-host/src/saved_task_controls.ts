import { createServer, createConnection } from "node:net";
import { chmod, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import * as formsImport from "../../convex/runtime_host/input_form.ts";
import { PermissionDecisionSchema, WorkerToHostMessageSchema } from "./protocol.ts";
import type { RuntimeCommand, RuntimeEvent } from "./control_plane.ts";
import { digest } from "./saved_task_store.ts";
function compatible<T extends object>(module: T): T {
  return "default" in module ? (module as T & { default: T }).default : module;
}
const { projectRuntimeInputForm, validateRuntimeInput } = compatible(formsImport);
export type SavedNativeRequest = {
  id: string; resultId: string; type: "input" | "permission"; prompt: string;
  choices: string[]; form?: ReturnType<typeof projectRuntimeInputForm>;
};
const ControlSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("list") }),
  z.strictObject({ action: z.literal("stop"), resultId: z.string() }),
  z.strictObject({ action: z.literal("permission"), resultId: z.string(), requestId: z.string(), decision: PermissionDecisionSchema }),
  z.strictObject({ action: z.literal("input"), resultId: z.string(), requestId: z.string(), cancelled: z.boolean(), content: z.unknown() }),
]);
export function savedControlPath(root: string, taskId: string) {
  return join("/tmp", `nanthai-saved-${process.getuid?.() ?? "local"}`, `${digest(`${root}:${taskId}`).slice(0, 40)}.sock`);
}
export async function callSavedControl(root: string, taskId: string, value: unknown): Promise<unknown> {
  const request = ControlSchema.parse(value);
  return new Promise((resolve, reject) => {
    const socket = createConnection(savedControlPath(root, taskId));
    let data = "";
    socket.once("connect", () => socket.end(`${JSON.stringify(request)}\n`));
    socket.on("data", chunk => { data += chunk.toString(); });
    socket.once("error", reject);
    socket.once("end", () => {
      try {
        const response = JSON.parse(data) as { result?: unknown; error?: string };
        if (response.error) reject(new Error(response.error)); else resolve(response.result);
      } catch (error) { reject(error); }
    });
  });
}
export async function pendingSavedControls(root: string, taskId: string): Promise<SavedNativeRequest[]> {
  try { return await callSavedControl(root, taskId, { action: "list" }) as SavedNativeRequest[]; }
  catch (error) {
    if (error instanceof Error && "code" in error && ["ENOENT", "ECONNREFUSED"].includes(String(error.code))) return [];
    throw error;
  }
}
export class SavedTaskControls {
  private readonly requests = new Map<string, { shown: SavedNativeRequest; raw: string }>();
  private server?: ReturnType<typeof createServer>;
  private path = "";
  constructor(private readonly command: RuntimeCommand, private readonly resultId: string,
    private readonly dispatch: (command: RuntimeCommand) => Promise<void>) {}
  observe(event: RuntimeEvent) {
    const parsed = WorkerToHostMessageSchema.safeParse(event.payload);
    if (!parsed.success || parsed.data.kind !== "adapter_event") return;
    const item = parsed.data.payload.event;
    if (item.type === "input_requested") {
      const raw = JSON.stringify(item);
      this.requests.set(item.inputRequestId, { raw, shown: { id: item.inputRequestId, resultId: this.resultId,
        type: "input", prompt: item.prompt, choices: [], form: projectRuntimeInputForm(raw) } });
    } else if (item.type === "permission_requested") {
      this.requests.set(item.permissionRequestId, { raw: "", shown: { id: item.permissionRequestId,
        resultId: this.resultId, type: "permission", prompt: item.prompt, choices: item.choices } });
    } else if (item.type === "input_resolved") this.requests.delete(item.inputRequestId);
    else if (item.type === "permission_resolved") this.requests.delete(item.permissionRequestId);
  }
  async open(root: string, taskId: string) {
    this.path = savedControlPath(root, taskId);
    const directory = join("/tmp", `nanthai-saved-${process.getuid?.() ?? "local"}`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    await rm(this.path, { force: true }); // Per-task lock is already owned.
    this.server = createServer({ allowHalfOpen: true }, socket => {
      let data = "";
      socket.on("data", chunk => { data += chunk.toString(); });
      socket.once("end", () => {
        void Promise.resolve().then(() => this.handle(JSON.parse(data) as unknown)).then(result => socket.end(JSON.stringify({ result })),
          error => socket.end(JSON.stringify({ error: error instanceof Error ? error.message : "Native response failed" })));
      });
      socket.on("error", () => socket.destroy());
    });
    await new Promise<void>((resolve, reject) => { this.server!.once("error", reject); this.server!.listen(this.path, resolve); });
    await chmod(this.path, 0o600);
  }
  private async handle(value: unknown) {
    const input = ControlSchema.parse(value);
    if (input.action === "list") return [...this.requests.values()].map(item => item.shown);
    if (input.resultId !== this.resultId) throw new Error("This local turn has already changed.");
    let kind: "cancel" | "permission_response" | "prompt";
    let payload: object;
    if (input.action === "stop") {
      kind = "cancel"; payload = { cancellationId: `cancel-${this.resultId}`, reason: "Stopped by the user" };
    } else {
      const request = this.requests.get(input.requestId);
      if (!request) throw new Error("This native request is no longer waiting.");
      if (input.action === "permission") {
        if (request.shown.type !== "permission" || !request.shown.choices.includes(input.decision)) throw new Error("Choose an offered native decision.");
        kind = "permission_response"; payload = { permissionRequestId: input.requestId, decision: input.decision };
      } else {
        if (request.shown.type !== "input") throw new Error("This native request expects a permission decision.");
        kind = "prompt"; payload = { inputRequestId: input.requestId, response: input.cancelled
          ? { outcome: "cancelled", content: null } : { outcome: "submitted", content: validateRuntimeInput(request.raw, input.content) } };
      }
    }
    const id = randomUUID();
    await this.dispatch({ ...this.command, commandRecordId: id, commandId: id, kind,
      payload: { type: kind, authorizationSource: "explicit_user_turn", inputHash: id,
        rawPayload: JSON.stringify(payload), turnPacketId: null, packet: null, packetSha256: null, packetError: null } });
    if (input.action !== "stop") this.requests.delete(input.requestId);
    return { accepted: true };
  }
  async close() {
    if (this.server) await new Promise<void>(resolve => this.server!.close(() => resolve()));
    if (this.path) await rm(this.path, { force: true });
    this.requests.clear();
  }
}
