import assert from "node:assert/strict";
import test from "node:test";

import {
  BoundedEventBuffer,
  EventBufferCapacityError,
} from "../src/bounded_event_buffer.ts";

test("evicts only explicitly evictable events", () => {
  const buffer = new BoundedEventBuffer<{ id: number }>({ maxItems: 2, maxBytes: 100 });
  buffer.push({ id: 1 });
  buffer.push({ id: 2 }, { evictable: true });
  buffer.push({ id: 3 });

  assert.deepEqual(buffer.drain(), [{ id: 1 }, { id: 3 }]);
  assert.equal(buffer.snapshot().evictedItems, 1);
});

test("refuses to discard consequential events", () => {
  const buffer = new BoundedEventBuffer<{ id: number }>({ maxItems: 1, maxBytes: 100 });
  buffer.push({ id: 1 });
  assert.throws(() => buffer.push({ id: 2 }), EventBufferCapacityError);
  assert.deepEqual(buffer.drain(), [{ id: 1 }]);
});
