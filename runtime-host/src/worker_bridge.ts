import { BridgeRequestSchema } from "./protocol.ts";
import type { WorkerWireOutput } from "./worker_wire_output.ts";
import type { HostToWorkerMessage } from "./protocol.ts";

type Reply = Extract<HostToWorkerMessage, { kind: "bridge_response" }>["payload"];
export class WorkerBridge {
  private readonly pending = new Map<string, (reply: Reply) => void>();
  constructor(private readonly output: WorkerWireOutput) {}
  async call(value: unknown) {
    const request = BridgeRequestSchema.parse(value);
    if (this.pending.has(request.callId)) throw new Error("Duplicate pending bridge call");
    const reply = await new Promise<Reply>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.callId);
        resolve({ callId: request.callId, success: false, text: "NanthAI publication acknowledgement timed out. Retry the same publication; do not claim success." });
      }, 30_000);
      this.pending.set(request.callId, (result) => { clearTimeout(timer); resolve(result); });
      this.output.emit({ kind: "bridge_call", payload: request });
    });
    return { success: reply.success, contentItems: [{ type: "inputText", text: reply.text }] };
  }
  reply(value: Reply): void {
    const resolve = this.pending.get(value.callId);
    if (!resolve) return;
    this.pending.delete(value.callId);
    resolve(value);
  }
}
