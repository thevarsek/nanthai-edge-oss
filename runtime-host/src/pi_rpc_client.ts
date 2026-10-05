import { randomUUID } from "node:crypto";
import { OwnedProcess, type OwnedProcessSpec } from "./process_tree.ts";

export type PiRecord = Record<string, unknown> & { type: string };
type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout | null };

/** Pi's JSONL protocol uses LF, not JavaScript's broader line-separator rules. */
export class PiRpcClient {
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<(event: PiRecord) => void>();
  private readonly failures = new Set<(error: Error) => void>();
  private buffer = "";
  private closed = false;

  constructor(private readonly process: OwnedProcess, private readonly timeoutMs = 30_000) {
    process.child.stdout.setEncoding("utf8");
    process.child.stdout.on("data", (chunk: string) => this.receive(chunk));
    process.child.stderr.resume();
    void process.exit.then(
      () => this.fail(new Error("Pi process exited")),
      () => this.fail(new Error("Pi process could not start")),
    );
  }

  static spawn(spec: OwnedProcessSpec): PiRpcClient {
    return new PiRpcClient(OwnedProcess.spawn(spec));
  }

  onEvent(listener: (event: PiRecord) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onFailure(listener: (error: Error) => void): () => void {
    this.failures.add(listener);
    return () => this.failures.delete(listener);
  }

  async request(type: string, fields: Record<string, unknown> = {}): Promise<unknown> {
    if (this.closed) throw new Error("Pi process is closed");
    const id = randomUUID();
    const result = new Promise<unknown>((resolve, reject) => {
      // Pi may await a native user dialog before acknowledging a prompt.
      const timer = type === "prompt" ? null : setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Pi request timed out: ${type}`));
      }, this.timeoutMs);
      timer?.unref();
      this.pending.set(id, { resolve, reject, timer });
    });
    try { this.write({ ...fields, type, id }); }
    catch { this.fail(new Error("Pi request could not be written")); }
    return result;
  }

  write(record: PiRecord): void {
    if (this.closed) throw new Error("Pi process is closed");
    this.process.child.stdin.write(`${JSON.stringify(record)}\n`);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.rejectPending(new Error("Pi process closed"));
    this.process.child.stdin.end();
    await this.process.terminate();
  }

  private receive(chunk: string): void {
    if (this.closed) return;
    this.buffer += chunk;
    try {
      let newline: number;
      while ((newline = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        this.checkLength(line);
        if (!line.trim()) continue;
        const value: unknown = JSON.parse(line);
        if (!value || typeof value !== "object" || !("type" in value)
          || typeof value.type !== "string" || Array.isArray(value)) throw new Error("Invalid Pi record");
        const record = value as PiRecord;
        if (record.type === "response") this.response(record);
        else for (const listener of this.listeners) listener(record);
      }
      this.checkLength(this.buffer);
    } catch {
      this.fail(new Error("Invalid Pi JSONL stream"));
    }
  }

  private checkLength(line: string): void {
    if (Buffer.byteLength(line) > 16 * 1024 * 1024) throw new Error("Pi record exceeded wire capacity");
  }

  private response(record: PiRecord): void {
    if (typeof record.id !== "string") throw new Error("Pi response has no request ID");
    const pending = this.pending.get(record.id);
    // A timed-out command can still return. Its result no longer owns a waiter.
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    this.pending.delete(record.id);
    if (record.success === true) pending.resolve(record.data);
    else pending.reject(new Error("Pi rejected the requested command"));
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectPending(error);
    for (const listener of this.failures) listener(error);
    void this.process.terminate().catch(() => undefined);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
