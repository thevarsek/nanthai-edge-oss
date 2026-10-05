import { AsyncEventQueue } from "./async_event_queue.ts";
import { OwnedProcess, type OwnedProcessSpec, type ProcessExit } from "./process_tree.ts";
import { samplePosixProcessGroup } from "./process_group_resources.ts";
import {
  HostToWorkerMessageSchema,
  WorkerToHostMessageSchema,
  type HostToWorkerMessage,
  type WorkerToHostMessage,
} from "./protocol.ts";
import { ResourceSampler, type ResourceSummary } from "./resource_sampler.ts";

export type WireWorkerOptions = {
  maxLineBytes?: number;
  maxBufferedMessages?: number;
  maxBufferedBytes?: number;
};

export class WorkerProcessError extends Error {
  constructor(readonly exit: ProcessExit, message: string) {
    super(message);
    this.name = "WorkerProcessError";
  }
}

export class WireWorker implements AsyncIterable<WorkerToHostMessage> {
  private readonly process: OwnedProcess;
  private readonly drainedExit: Promise<ProcessExit>;
  private readonly events: AsyncEventQueue<WorkerToHostMessage>;
  private readonly maxLineBytes: number;
  private readonly sampler = new ResourceSampler();
  private stdoutBuffer = "";
  private lastIncomingSequence = -1;
  private lastOutgoingSequence = -1;
  private sessionClaimed = false;
  private closeRequested = false;
  private closed = false;

  private constructor(spec: OwnedProcessSpec, options: WireWorkerOptions) {
    this.process = OwnedProcess.spawn({ ...spec, processGroup: "new" });
    this.maxLineBytes = options.maxLineBytes ?? 4 * 1024 * 1024;
    this.events = new AsyncEventQueue({
      maxItems: options.maxBufferedMessages ?? 512,
      maxBytes: options.maxBufferedBytes ?? 4 * 1024 * 1024,
    });
    this.process.child.stdout.setEncoding("utf8");
    this.process.child.stdout.on("data", (chunk: string) => this.receive(chunk));
    this.process.child.stderr.resume();
    this.drainedExit = this.process.exit.then(
      async (exit) => {
        await this.handleExit(exit);
        return exit;
      },
      (error: unknown) => {
        this.fail(asError(error));
        throw error;
      },
    );
    void this.drainedExit.catch(() => undefined);
  }

  static spawn(spec: OwnedProcessSpec, options: WireWorkerOptions = {}): WireWorker {
    return new WireWorker(spec, options);
  }

  get pid(): number {
    return this.process.pid;
  }

  get exit(): Promise<ProcessExit> {
    return this.drainedExit;
  }

  send(value: HostToWorkerMessage | unknown): void {
    if (this.closed) throw new Error("Worker channel is closed");
    const message = HostToWorkerMessageSchema.parse(value);
    if (message.sequence <= this.lastOutgoingSequence) {
      throw new Error("Host-to-worker sequences must increase monotonically");
    }
    if (message.kind === "start_session_request" || message.kind === "resume_request") {
      if (this.sessionClaimed) {
        throw new Error("A worker process may own only one runtime session");
      }
      this.sessionClaimed = true;
    }
    if (message.kind === "close_request") this.closeRequested = true;
    this.lastOutgoingSequence = message.sequence;
    this.process.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async sampleResources(): Promise<ResourceSummary> {
    const child = await samplePosixProcessGroup(this.pid);
    this.sampler.sample(this.events.snapshot(), child);
    return this.sampler.summary();
  }

  async close(graceMs = 500): Promise<ProcessExit> {
    if (this.closed) return this.process.exit;
    this.closed = true;
    this.process.child.stdin.end();
    const exit = await this.process.terminate(graceMs);
    this.events.end();
    return exit;
  }

  [Symbol.asyncIterator](): AsyncIterator<WorkerToHostMessage> {
    return this.events[Symbol.asyncIterator]();
  }

  private receive(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newline = this.stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trimEnd();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (Buffer.byteLength(line, "utf8") > this.maxLineBytes) {
        this.fail(new Error("Worker JSONL line exceeded the byte limit"));
        return;
      }
      if (line.length > 0) this.parseLine(line);
      newline = this.stdoutBuffer.indexOf("\n");
    }
    if (Buffer.byteLength(this.stdoutBuffer, "utf8") > this.maxLineBytes) {
      this.fail(new Error("Unterminated worker JSONL line exceeded the byte limit"));
    }
  }

  private parseLine(line: string): void {
    try {
      const message = WorkerToHostMessageSchema.parse(JSON.parse(line) as unknown);
      if (message.sequence <= this.lastIncomingSequence) {
        throw new Error("Worker-to-host sequences must increase monotonically");
      }
      this.lastIncomingSequence = message.sequence;
      this.events.push(message, { evictable: isEvictable(message) });
    } catch (error) {
      this.fail(asError(error));
    }
  }

  private async handleExit(exit: ProcessExit): Promise<void> {
    let cleanupFailure: Error | null = null;
    try {
      await this.process.terminate();
    } catch (error) {
      cleanupFailure = asError(error);
    }

    if (this.closed || this.closeRequested) {
      this.closed = true;
      if (cleanupFailure === null) this.events.end();
      else this.events.fail(cleanupFailure);
      return;
    }

    this.closed = true;
    const label = exit.code === 0
      ? "Worker exited before the host closed its session"
      : `Worker crashed (${exit.code ?? exit.signal})`;
    const cleanupLabel = cleanupFailure === null
      ? label
      : `${label}; process-group cleanup failed: ${cleanupFailure.message}`;
    this.events.fail(new WorkerProcessError(exit, cleanupLabel));
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.events.fail(error);
    void this.process.terminate();
  }
}

function isEvictable(message: WorkerToHostMessage): boolean {
  return message.kind === "adapter_event" && message.payload.event.type === "heartbeat";
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
