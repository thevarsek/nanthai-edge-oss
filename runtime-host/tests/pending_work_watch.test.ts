import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptedRealtimeUrl,
  openPendingWorkWatch,
} from "../src/convex_pending_work_source.ts";
import { HttpJsonClient } from "../src/http_json_client.ts";
import { PendingWorkWatch, type PollWaiter } from "../src/pending_work_watch.ts";
import { FakePendingWorkSource } from "./fixtures/pending_work_source.ts";

function countingFallback(): PollWaiter & { calls: number } {
  const waiter = {
    calls: 0,
    begin: () => 0,
    wait: async () => { waiter.calls += 1; },
  };
  return waiter;
}

async function settles(promise: Promise<void>, withinMs = 20): Promise<boolean> {
  let done = false;
  void promise.then(() => { done = true; });
  await new Promise((resolve) => setTimeout(resolve, withinMs));
  return done;
}

test("idle live watch waits without polling until its kind has work", async () => {
  const source = new FakePendingWorkSource();
  const watch = new PendingWorkWatch(source);
  const fallback = countingFallback();
  source.push([]);
  const commands = watch.waiter("commands", fallback, 5);
  const discovery = watch.waiter("modelDiscovery", fallback, 5);
  const abort = new AbortController();

  const commandWait = commands.wait(commands.begin(), abort.signal);
  const discoveryWait = discovery.wait(discovery.begin(), abort.signal);
  assert.equal(await settles(commandWait), false);
  source.push([], ["discovery-1"]);
  assert.equal(await settles(discoveryWait), true);
  assert.equal(await settles(commandWait), false);
  source.push(["command-1"], ["discovery-1"]);
  assert.equal(await settles(commandWait), true);
  assert.equal(fallback.calls, 0);
  abort.abort();
});

test("work that arrives while a poll is in flight triggers an immediate re-poll", async () => {
  const source = new FakePendingWorkSource();
  const watch = new PendingWorkWatch(source);
  source.push([]);
  const waiter = watch.waiter("commands", countingFallback(), 5);
  const ticket = waiter.begin();
  source.push(["command-1"]);
  assert.equal(await settles(waiter.wait(ticket, new AbortController().signal), 1), true);
});

test("work the claim path leaves pending is retried with growing backoff", async () => {
  const source = new FakePendingWorkSource();
  const watch = new PendingWorkWatch(source);
  source.push(["stuck-command"]);
  const waiter = watch.waiter("commands", countingFallback(), 10);
  const signal = new AbortController().signal;
  const started = Date.now();
  await waiter.wait(waiter.begin(), signal);
  await waiter.wait(waiter.begin(), signal);
  await waiter.wait(waiter.begin(), signal);
  // 10 + 20 + 40 ms of backoff rather than three immediate polls.
  assert.ok(Date.now() - started >= 60);
  source.push([]);
  const idle = waiter.wait(waiter.begin(), signal);
  assert.equal(await settles(idle, 30), false);
});

test("watch falls back to timed polling until live, and after errors or disconnects", async () => {
  const source = new FakePendingWorkSource();
  const watch = new PendingWorkWatch(source);
  const fallback = countingFallback();
  const waiter = watch.waiter("commands", fallback, 5);
  const signal = new AbortController().signal;

  await waiter.wait(waiter.begin(), signal);
  assert.equal(fallback.calls, 1, "no result delivered yet");

  source.push([]);
  assert.equal(watch.live(), true);
  const pending = waiter.wait(waiter.begin(), signal);
  source.setConnected(false);
  assert.equal(await settles(pending), true, "disconnect wakes a waiting loop");
  await waiter.wait(waiter.begin(), signal);
  assert.equal(fallback.calls, 2);

  source.setConnected(true);
  source.fail();
  assert.equal(watch.live(), false);
  await waiter.wait(waiter.begin(), signal);
  assert.equal(fallback.calls, 3);

  source.push([]);
  assert.equal(watch.live(), true, "a later valid result restores push mode");
  source.pushRaw({ commandIds: "not-an-array" });
  assert.equal(watch.live(), false, "malformed results are not trusted");

  source.push([]);
  await watch.close();
  assert.equal(source.closed, true);
  assert.equal(watch.live(), false);
});

test("realtime URL must be HTTPS unless both endpoints are local development hosts", () => {
  const control = "https://example-123.convex.site";
  assert.equal(acceptedRealtimeUrl(control, "https://example-123.convex.cloud"), "https://example-123.convex.cloud");
  assert.equal(acceptedRealtimeUrl(control, "https://api.example.com/"), "https://api.example.com");
  assert.equal(acceptedRealtimeUrl(control, "http://example-123.convex.cloud"), null);
  assert.equal(acceptedRealtimeUrl(control, "https://user:pass@example.com"), null);
  assert.equal(acceptedRealtimeUrl(control, "https://example.com/?token=1"), null);
  assert.equal(acceptedRealtimeUrl(control, "not a url"), null);
  assert.equal(acceptedRealtimeUrl(control, "http://127.0.0.1:3210"), null);
  assert.equal(acceptedRealtimeUrl("http://127.0.0.1:3211", "http://127.0.0.1:3210"), "http://127.0.0.1:3210");
});

test("opening a watch falls back to polling when the endpoint is missing or unsafe", async () => {
  const args = { deviceId: "d", credentialId: "c", credential: "secret", presenceSessionId: "p" };
  const signal = new AbortController().signal;
  const opened: string[] = [];
  const create = (url: string) => { opened.push(url); return new FakePendingWorkSource(); };
  const client = (respond: () => Response) => new HttpJsonClient("https://example-123.convex.site", {
    fetch: async () => respond(),
  });

  assert.equal(await openPendingWorkWatch(
    client(() => Response.json({ error: { code: "NOT_FOUND", message: "missing" } }, { status: 404 })),
    "https://example-123.convex.site", args, create, signal,
  ), null);
  assert.equal(await openPendingWorkWatch(
    client(() => Response.json({ realtimeUrl: "http://evil.example.com" })),
    "https://example-123.convex.site", args, create, signal,
  ), null);
  assert.deepEqual(opened, []);

  const watch = await openPendingWorkWatch(
    client(() => Response.json({ realtimeUrl: "https://example-123.convex.cloud" })),
    "https://example-123.convex.site", args, create, signal,
  );
  assert.ok(watch instanceof PendingWorkWatch);
  assert.deepEqual(opened, ["https://example-123.convex.cloud"]);
  await watch.close();
});
