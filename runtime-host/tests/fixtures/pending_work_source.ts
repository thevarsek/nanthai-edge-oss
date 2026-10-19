import type { PendingWorkSource } from "../../src/pending_work_watch.ts";

export class FakePendingWorkSource implements PendingWorkSource {
  connected = true;
  closed = false;
  private update: ((value: unknown) => void) | null = null;
  private error: ((error: Error) => void) | null = null;
  private connection: ((connected: boolean) => void) | null = null;

  subscribe(onUpdate: (value: unknown) => void, onError: (error: Error) => void): () => void {
    this.update = onUpdate;
    this.error = onError;
    return () => { this.update = null; };
  }

  onConnectionChange(callback: (connected: boolean) => void): () => void {
    this.connection = callback;
    return () => { this.connection = null; };
  }

  isConnected(): boolean { return this.connected; }

  async close(): Promise<void> { this.closed = true; }

  push(commandIds: string[], modelDiscoveryRequestIds: string[] = []): void {
    this.update?.({ commandIds, modelDiscoveryRequestIds });
  }

  pushRaw(value: unknown): void { this.update?.(value); }

  fail(): void { this.error?.(new Error("Runtime Host credential is invalid or revoked")); }

  setConnected(connected: boolean): void {
    this.connected = connected;
    this.connection?.(connected);
  }
}
