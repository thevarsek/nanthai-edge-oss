import { z } from "zod";

// Push-based wake-ups for the host's claim loops. The host subscribes to the
// control plane's pending-work query over a WebSocket and only polls the HTTP
// claim routes when that subscription reports work. When the subscription is
// unavailable, unhealthy or disconnected, the loops fall back to timed polling.

export type PendingWorkKind = "commands" | "modelDiscovery";

export interface PendingWorkSource {
  subscribe(onUpdate: (value: unknown) => void, onError: (error: Error) => void): () => void;
  onConnectionChange(callback: (connected: boolean) => void): () => void;
  isConnected(): boolean;
  close(): Promise<void>;
}

export interface PollWaiter {
  /** Capture the work version before polling, so work arriving mid-poll is not missed. */
  begin(): number;
  /** Wait until the next poll is due. */
  wait(ticket: number, signal: AbortSignal): Promise<void>;
}

const PendingWorkSchema = z.object({
  commandIds: z.array(z.string().min(1)).max(100),
  modelDiscoveryRequestIds: z.array(z.string().min(1)).max(10),
});

type PendingWork = z.infer<typeof PendingWorkSchema>;

const MAX_STUCK_BACKOFF_MS = 30_000;

export function fixedIntervalWaiter(
  intervalMs: number,
  delay: (milliseconds: number, signal: AbortSignal) => Promise<void>,
): PollWaiter {
  return { begin: () => 0, wait: (_ticket, signal) => delay(intervalMs, signal) };
}

export class PendingWorkWatch {
  private work: PendingWork | null = null;
  private healthy = false;
  private connected: boolean;
  private closed = false;
  private readonly versions: Record<PendingWorkKind, number> = { commands: 0, modelDiscovery: 0 };
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;
  private readonly stopConnectionWatch: () => void;

  constructor(private readonly source: PendingWorkSource) {
    this.connected = source.isConnected();
    this.stopConnectionWatch = source.onConnectionChange((connected) => {
      this.connected = connected;
      this.notify();
    });
    this.unsubscribe = source.subscribe(
      (value) => this.accept(value),
      () => {
        this.healthy = false;
        this.notify();
      },
    );
  }

  /** True only while the subscription is connected and has delivered a valid result. */
  live(): boolean {
    return !this.closed && this.connected && this.healthy;
  }

  pending(kind: PendingWorkKind): number {
    if (this.work === null) return 0;
    return kind === "commands"
      ? this.work.commandIds.length
      : this.work.modelDiscoveryRequestIds.length;
  }

  waiter(kind: PendingWorkKind, fallback: PollWaiter, minimumBackoffMs: number): PollWaiter {
    let backoffMs = 0;
    return {
      begin: () => this.versions[kind],
      wait: async (ticket, signal) => {
        if (!this.live()) {
          backoffMs = 0;
          await fallback.wait(fallback.begin(), signal);
          return;
        }
        if (this.pending(kind) === 0) {
          backoffMs = 0;
        } else if (this.versions[kind] !== ticket) {
          return; // New work arrived while the previous poll was in flight.
        } else {
          // Work is visible but the claim path did not take it (for example, its
          // run is still leased). Retry with backoff rather than every second.
          backoffMs = Math.min(MAX_STUCK_BACKOFF_MS, Math.max(backoffMs * 2, minimumBackoffMs));
        }
        await this.until(
          () => !this.live() || (this.versions[kind] !== ticket && this.pending(kind) > 0),
          backoffMs === 0 ? null : backoffMs,
          signal,
        );
      },
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    this.stopConnectionWatch();
    this.notify();
    await this.source.close();
  }

  private accept(value: unknown): void {
    const parsed = PendingWorkSchema.safeParse(value);
    if (!parsed.success) {
      this.healthy = false;
      this.notify();
      return;
    }
    const previous = this.work;
    this.work = parsed.data;
    this.healthy = true;
    if (!sameIds(previous?.commandIds, parsed.data.commandIds)) this.versions.commands += 1;
    if (!sameIds(previous?.modelDiscoveryRequestIds, parsed.data.modelDiscoveryRequestIds)) {
      this.versions.modelDiscovery += 1;
    }
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private until(
    predicate: () => boolean,
    timeoutMs: number | null,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted || predicate()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const finish = () => {
        this.listeners.delete(check);
        signal.removeEventListener("abort", finish);
        if (timer !== null) clearTimeout(timer);
        resolve();
      };
      const check = () => { if (predicate()) finish(); };
      const timer = timeoutMs === null ? null : setTimeout(finish, timeoutMs);
      this.listeners.add(check);
      signal.addEventListener("abort", finish, { once: true });
    });
  }
}

function sameIds(left: readonly string[] | undefined, right: readonly string[]): boolean {
  return left !== undefined
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}
