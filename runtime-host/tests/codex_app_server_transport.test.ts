import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { JsonRpcStdioClient } from "../src/json_rpc_stdio_client.ts";
import { CodexAppServerTransport } from "../src/transports/codex_app_server_transport.ts";

const fixture = fileURLToPath(new URL("./fixtures/fake_json_rpc_child.mjs", import.meta.url));

test("starts with native instructions, injects history, and lists models", async () => {
  const { client, transport } = createTransport();
  try {
    const session = await transport.startSession({
      model: "gpt-test",
      baseInstructions: "System instruction",
      developerInstructions: "Persona instruction",
      injectedHistory: [{
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "prior" }],
      }],
    });
    assert.equal(session.nativeSessionId, "thread-1");
    assert.equal((await transport.listModels())[0]?.id, "gpt-test");
    const state = await client.request("debug/state") as {
      lastInitialize: Record<string, unknown>;
      lastThreadStart: Record<string, unknown>;
      injectedItems: unknown[];
    };
    assert.deepEqual(state.lastInitialize.capabilities, {
      experimentalApi: true,
      requestAttestation: false,
    });
    assert.equal(state.lastThreadStart.baseInstructions, "System instruction");
    assert.equal(state.lastThreadStart.developerInstructions, "Persona instruction");
    assert.equal(state.injectedItems.length, 1);
    await transport.close(session);
  } finally {
    await transport.closeProcess();
  }
});

test("sets the native thread name after open and before turn/start", async () => {
  const { client, transport } = createTransport();
  try {
    const session = await transport.startSession({});
    await transport.setThreadName("thread-1", "Architect · Runtime host");
    for await (const event of transport.sendTurn(session, [{ type: "text", text: "hello" }])) {
      // Drain the deterministic turn so its request is recorded by the fixture.
      void event;
    }
    const state = await client.request("debug/state") as {
      threadNames: Record<string, string>;
      methodOrder: string[];
    };
    assert.equal(state.threadNames["thread-1"], "Architect · Runtime host");
    assert.ok(state.methodOrder.indexOf("thread/start")
      < state.methodOrder.indexOf("thread/name/set"));
    assert.ok(state.methodOrder.indexOf("thread/name/set")
      < state.methodOrder.indexOf("turn/start"));
  } finally {
    await transport.closeProcess();
  }
});

test("streams approval requests and resumes only after a response", async () => {
  const { transport } = createTransport();
  try {
    const session = await transport.startSession({});
    const iterator = transport.sendTurn(session, [
      { type: "text", text: "APPROVAL" },
    ])[Symbol.asyncIterator]();
    assert.equal((await iterator.next()).value?.type, "notification");
    const approval = (await iterator.next()).value;
    assert.equal(approval?.type, "server_request");
    if (approval?.type !== "server_request") throw new Error("Expected server request");
    await transport.respondToApproval(session, approval.requestId, { decision: "decline" });
    const terminal = (await iterator.next()).value;
    assert.equal(terminal?.type, "notification");
    assert.equal(terminal?.type === "notification" ? terminal.method : null, "turn/completed");
    assert.equal((await iterator.next()).done, true);
  } finally {
    await transport.closeProcess();
  }
});

test("interrupts an active turn and surfaces child crashes", async () => {
  const first = createTransport();
  try {
    const session = await first.transport.startSession({});
    const iterator = first.transport.sendTurn(session, [
      { type: "text", text: "WAIT" },
    ])[Symbol.asyncIterator]();
    await iterator.next();
    await first.transport.cancel(session);
    const completion = (await iterator.next()).value;
    assert.equal(completion?.type === "notification" ? completion.method : null, "turn/completed");
  } finally {
    await first.transport.closeProcess();
  }

  const second = createTransport();
  try {
    const session = await second.transport.startSession({});
    const iterator = second.transport.sendTurn(session, [
      { type: "text", text: "CRASH" },
    ])[Symbol.asyncIterator]();
    await assert.rejects(iterator.next(), /exited|crash/i);
  } finally {
    await second.transport.closeProcess();
  }
});

test("queues cancellation while turn/start is still in flight", async () => {
  const { transport } = createTransport();
  try {
    const session = await transport.startSession({});
    const iterator = transport.sendTurn(session, [
      { type: "text", text: "SLOW_START WAIT" },
    ])[Symbol.asyncIterator]();
    const firstEvent = iterator.next();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await transport.cancel(session);
    assert.equal((await firstEvent).value?.type, "notification");
    const completion = (await iterator.next()).value;
    assert.equal(completion?.type === "notification" ? completion.method : null, "turn/completed");
  } finally {
    await transport.closeProcess();
  }
});

test("routes descendant events through the root turn without closing it early", async () => {
  const { transport } = createTransport();
  try {
    const session = await transport.startSession({});
    const events = [];
    for await (const event of transport.sendTurn(session, [
      { type: "text", text: "NATIVE_AGENT" },
    ])) events.push(event);
    const methods = events.map((event) => event.type === "notification" ? event.method : null);
    const childStarted = events.findIndex((event) => event.type === "notification"
      && event.method === "turn/started"
      && (event.params as { threadId?: string }).threadId === "thread-1-child-1");
    const childOutput = events.findIndex((event) => event.type === "notification"
      && event.method === "item/agentMessage/delta"
      && (event.params as { threadId?: string }).threadId === "thread-1-child-1");
    const childCompletion = events.findIndex((event) => event.type === "notification"
      && event.method === "turn/completed"
      && (event.params as { threadId?: string }).threadId === "thread-1-child-1");
    const rootText = methods.indexOf("item/agentMessage/delta", childCompletion + 1);
    const rootCompletion = methods.lastIndexOf("turn/completed");
    assert.ok(childStarted >= 0);
    assert.ok(childOutput > childStarted);
    assert.ok(childCompletion > childOutput);
    assert.ok(rootText > childCompletion);
    assert.ok(rootCompletion > rootText);
    assert.equal(events.some((event) => event.type === "notification"
      && event.method === "thread/started"
      && (event.params as { thread?: { parentThreadId?: string } }).thread?.parentThreadId), false);
  } finally {
    await transport.closeProcess();
  }
});

test("ignores late events and cancellation after native completion while output drains", async () => {
  const { client, transport } = createTransport();
  try {
    const session = await transport.startSession({});
    const iterator = transport.sendTurn(session, [
      { type: "text", text: "hello" },
    ])[Symbol.asyncIterator]();
    await iterator.next();
    // The response is ordered after completion on stdout; the iterator is
    // deliberately suspended with that completion still queued.
    await client.request("debug/state");
    await transport.cancel(session);
    await client.request("debug/late-events", {
      threadId: session.nativeSessionId, turnId: `turn-${session.nativeSessionId}`,
    });
    const completion = (await iterator.next()).value;
    assert.equal(completion?.type === "notification" ? completion.method : null, "turn/completed");
    assert.equal((await iterator.next()).done, true);
    const state = await client.request("debug/state") as { interruptCount: number };
    assert.equal(state.interruptCount, 0);
    const nextEvents = [];
    for await (const event of transport.sendTurn(session, [{ type: "text", text: "next" }])) {
      nextEvents.push(event);
    }
    assert.equal(nextEvents.length, 2);
  } finally {
    await transport.closeProcess();
  }
});

test("enables native optional questions on start and resume while preserving search selection", async () => {
  const { client, transport } = createTransport();
  try {
    const readConfig = async () => (await client.request("debug/state") as {
      lastThreadStart: { config?: unknown };
    }).lastThreadStart.config;
    const session = await transport.startSession({ webSearch: "live" });
    assert.deepEqual(await readConfig(), { "features.default_mode_request_user_input": true, web_search: "live" });
    await transport.resumeSession(session.nativeSessionId ?? "thread-1", { webSearch: "live" });
    assert.deepEqual(await readConfig(), { "features.default_mode_request_user_input": true, web_search: "live" });
    await transport.startSession({});
    assert.deepEqual(await readConfig(), { "features.default_mode_request_user_input": true });
  } finally {
    await transport.closeProcess();
  }
});

function createTransport() {
  const client = JsonRpcStdioClient.spawn({ command: process.execPath, args: [fixture] });
  return { client, transport: new CodexAppServerTransport(client) };
}
