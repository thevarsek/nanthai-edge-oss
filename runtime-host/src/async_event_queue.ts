import {
  BoundedEventBuffer,
  type EventBufferLimits,
} from "./bounded_event_buffer.ts";

type WaitingConsumer<T> = {
  resolve: (result: IteratorResult<T>) => void;
  reject: (error: Error) => void;
};

export class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly buffer: BoundedEventBuffer<T>;
  private readonly waiting: WaitingConsumer<T>[] = [];
  private ended = false;
  private failure: Error | null = null;

  constructor(limits: EventBufferLimits) {
    this.buffer = new BoundedEventBuffer(limits);
  }

  push(value: T, options: { evictable?: boolean } = {}): void {
    if (this.ended) {
      throw new Error("Cannot push into a closed event queue");
    }
    const consumer = this.waiting.shift();
    if (consumer !== undefined) {
      consumer.resolve({ done: false, value });
      return;
    }
    this.buffer.push(value, options);
  }

  end(): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    this.flushWaiting();
  }

  fail(error: Error): void {
    if (this.ended) {
      return;
    }
    this.failure = error;
    this.ended = true;
    this.flushWaiting();
  }

  snapshot() {
    return this.buffer.snapshot();
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => this.next(),
    };
  }

  private async next(): Promise<IteratorResult<T>> {
    const value = this.buffer.shift();
    if (value !== undefined) {
      return { done: false, value };
    }
    if (this.failure !== null) {
      throw this.failure;
    }
    if (this.ended) {
      return { done: true, value: undefined };
    }
    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.waiting.push({ resolve, reject });
    });
  }

  private flushWaiting(): void {
    for (const consumer of this.waiting.splice(0)) {
      if (this.failure === null) {
        consumer.resolve({ done: true, value: undefined });
      } else {
        consumer.reject(this.failure);
      }
    }
  }
}
