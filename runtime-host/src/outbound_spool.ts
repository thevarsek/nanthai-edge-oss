import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

import type { RuntimeEvent } from "./control_plane.ts";

const RuntimeEventSchema = z.strictObject({
  eventId: z.string().min(1).max(256),
  commandRecordId: z.string().min(1).max(256),
  commandId: z.string().min(1).max(256),
  runId: z.string().min(1).max(256),
  attemptId: z.string().min(1).max(256),
  fence: z.number().int().positive(),
  kind: z.enum(["worker_message", "host_command_failed"]),
  emittedAtMs: z.number().int().nonnegative(),
  payload: z.unknown(),
});
const SpoolFileSchema = z.strictObject({
  version: z.literal(1),
  events: z.array(RuntimeEventSchema),
});

export interface OutboundSpool {
  enqueue(event: RuntimeEvent): Promise<void>;
  peek(limit: number): Promise<readonly RuntimeEvent[]>;
  acknowledge(eventIds: readonly string[]): Promise<void>;
  size(): Promise<{ events: number; bytes: number }>;
}

export class SpoolCapacityError extends Error {
  constructor(readonly maxEvents: number, readonly maxBytes: number) {
    super("Outbound event spool is full; consequential events were not discarded");
    this.name = "SpoolCapacityError";
  }
}

export type FileOutboundSpoolOptions = {
  maxEvents?: number;
  maxBytes?: number;
};

export class FileOutboundSpool implements OutboundSpool {
  private readonly maxEvents: number;
  private readonly maxBytes: number;
  private events: RuntimeEvent[] = [];
  private bytes = encodedBytes([]);
  private loaded: Promise<void> | null = null;
  private writeTask: Promise<void> | null = null;
  private dirty = false;

  constructor(private readonly path: string, options: FileOutboundSpoolOptions = {}) {
    this.maxEvents = options.maxEvents ?? 2_000;
    this.maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
    if (this.maxEvents < 1 || this.maxBytes < 1) {
      throw new RangeError("Spool limits must be positive");
    }
  }

  async enqueue(event: RuntimeEvent): Promise<void> {
    await this.load();
    if (!this.events.some((stored) => stored.eventId === event.eventId)) {
      const stored = canonicalEvent(event);
      const bytes = this.bytes + Buffer.byteLength(JSON.stringify(stored), "utf8")
        + (this.events.length === 0 ? 0 : 1);
      if (this.events.length >= this.maxEvents || bytes > this.maxBytes) {
        throw new SpoolCapacityError(this.maxEvents, this.maxBytes);
      }
      this.events = [...this.events, stored];
      this.bytes = bytes;
      this.dirty = true;
    }
    await this.persist();
  }

  async peek(limit: number): Promise<readonly RuntimeEvent[]> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError("Spool peek limit must be a positive integer");
    }
    await this.load();
    await this.persist();
    return this.events.slice(0, limit);
  }

  async acknowledge(eventIds: readonly string[]): Promise<void> {
    await this.load();
    const accepted = new Set(eventIds);
    const next = this.events.filter((event) => !accepted.has(event.eventId));
    if (next.length !== this.events.length) {
      this.events = next;
      this.bytes = encodedBytes(next);
      this.dirty = true;
    }
    await this.persist();
  }

  async size(): Promise<{ events: number; bytes: number }> {
    await this.load();
    return { events: this.events.length, bytes: this.bytes };
  }

  private load(): Promise<void> {
    // The host lock gives this spool one writer for its entire lifetime.
    this.loaded ??= this.read().then((events) => {
      this.events = events;
      this.bytes = encodedBytes(events);
    });
    return this.loaded;
  }

  private persist(): Promise<void> {
    if (this.writeTask !== null) return this.writeTask;
    if (!this.dirty) return Promise.resolve();
    this.writeTask = this.persistChanges();
    return this.writeTask;
  }

  private async persistChanges(): Promise<void> {
    try {
      while (this.dirty) {
        this.dirty = false;
        await this.write(this.events);
      }
    } catch (error) {
      this.dirty = true;
      throw error;
    } finally {
      this.writeTask = null;
    }
  }

  private async read(): Promise<RuntimeEvent[]> {
    try {
      const parsed = SpoolFileSchema.parse(JSON.parse(await readFile(this.path, "utf8")) as unknown);
      return parsed.events;
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }

  private async write(events: readonly RuntimeEvent[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, events }), {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, this.path);
  }
}

export class InMemoryOutboundSpool implements OutboundSpool {
  private events: RuntimeEvent[] = [];

  async enqueue(event: RuntimeEvent): Promise<void> {
    if (!this.events.some((stored) => stored.eventId === event.eventId)) {
      this.events.push(canonicalEvent(event));
    }
  }

  async peek(limit: number): Promise<readonly RuntimeEvent[]> {
    return this.events.slice(0, limit);
  }

  async acknowledge(eventIds: readonly string[]): Promise<void> {
    const accepted = new Set(eventIds);
    this.events = this.events.filter((event) => !accepted.has(event.eventId));
  }

  async size(): Promise<{ events: number; bytes: number }> {
    return { events: this.events.length, bytes: encodedBytes(this.events) };
  }
}

function encodedBytes(events: readonly RuntimeEvent[]): number {
  return Buffer.byteLength(JSON.stringify({ version: 1, events }), "utf8");
}

function canonicalEvent(event: RuntimeEvent): RuntimeEvent {
  const encoded = JSON.stringify(RuntimeEventSchema.parse(event));
  if (encoded === undefined) throw new TypeError("Runtime event is not JSON serializable");
  return RuntimeEventSchema.parse(JSON.parse(encoded) as unknown);
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}
