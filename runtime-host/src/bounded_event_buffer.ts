export type EventBufferLimits = {
  maxItems: number;
  maxBytes: number;
};

export type EventBufferSnapshot = {
  items: number;
  bytes: number;
  evictedItems: number;
  evictedBytes: number;
};

type BufferedEvent<T> = {
  value: T;
  bytes: number;
  evictable: boolean;
};

export class EventBufferCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventBufferCapacityError";
  }
}

export class BoundedEventBuffer<T> {
  private readonly entries: Array<BufferedEvent<T>> = [];
  private bufferedBytes = 0;
  private evictedItems = 0;
  private evictedBytes = 0;

  constructor(private readonly limits: EventBufferLimits) {
    if (limits.maxItems < 1 || limits.maxBytes < 1) {
      throw new RangeError("Event buffer limits must be positive");
    }
  }

  push(value: T, options: { evictable?: boolean } = {}): boolean {
    const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
    if (bytes > this.limits.maxBytes) {
      throw new EventBufferCapacityError(
        `Event requires ${bytes} bytes, above the ${this.limits.maxBytes}-byte limit`,
      );
    }

    this.entries.push({ value, bytes, evictable: options.evictable ?? false });
    this.bufferedBytes += bytes;

    while (this.isOverLimit()) {
      const evictableIndex = this.entries.findIndex((entry) => entry.evictable);
      if (evictableIndex < 0) {
        const rejected = this.entries.pop();
        if (rejected !== undefined) {
          this.bufferedBytes -= rejected.bytes;
        }
        throw new EventBufferCapacityError(
          "Event buffer contains only unacknowledged consequential events",
        );
      }
      this.evictAt(evictableIndex);
    }

    return this.entries.some((entry) => entry.value === value);
  }

  shift(): T | undefined {
    const entry = this.entries.shift();
    if (entry === undefined) {
      return undefined;
    }
    this.bufferedBytes -= entry.bytes;
    return entry.value;
  }

  drain(): T[] {
    const values = this.entries.map((entry) => entry.value);
    this.entries.length = 0;
    this.bufferedBytes = 0;
    return values;
  }

  snapshot(): EventBufferSnapshot {
    return {
      items: this.entries.length,
      bytes: this.bufferedBytes,
      evictedItems: this.evictedItems,
      evictedBytes: this.evictedBytes,
    };
  }

  private isOverLimit(): boolean {
    return (
      this.entries.length > this.limits.maxItems ||
      this.bufferedBytes > this.limits.maxBytes
    );
  }

  private evictAt(index: number): void {
    const [entry] = this.entries.splice(index, 1);
    if (entry === undefined) {
      return;
    }
    this.bufferedBytes -= entry.bytes;
    this.evictedItems += 1;
    this.evictedBytes += entry.bytes;
  }
}
