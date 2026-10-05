import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { abortableDelay } from "../src/abortable_delay.ts";

test("completed polling and heartbeat waits release their abort listeners", async () => {
  const controller = new AbortController();
  for (let index = 0; index < 1_000; index++) {
    await abortableDelay(0, controller.signal);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  }
  for (const ref of [true, false]) {
    const waitingController = new AbortController();
    const waiting = abortableDelay(60_000, waitingController.signal, ref);
    assert.equal(getEventListeners(waitingController.signal, "abort").length, 1);
    waitingController.abort();
    await waiting;
    assert.equal(getEventListeners(waitingController.signal, "abort").length, 0);
  }
  controller.abort();
  await abortableDelay(60_000, controller.signal);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});
