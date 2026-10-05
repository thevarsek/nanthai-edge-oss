import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CanonicalCodexAdapter } from "../src/canonical_codex_adapter.ts";
import { CodexAdapter } from "../src/codex_adapter.ts";
import { selectCodexTransport } from "../src/codex_capabilities.ts";
import { JsonRpcStdioClient } from "../src/json_rpc_stdio_client.ts";
import { CodexAppServerTransport } from "../src/transports/codex_app_server_transport.ts";
import { runtimePacket } from "./fixtures/runtime_packet.ts";

const fixture = fileURLToPath(new URL("./fixtures/fake_json_rpc_child.mjs", import.meta.url));

test("App Server selection preserves unavailable and unsupported capability diagnostics", () => {
  assert.equal(selectCodexTransport({ operations: ["resume", "list_models"] }), "app_server_stdio");
  assert.throws(() => selectCodexTransport({}, []), {
    name: "CodexCapabilityPreflightError", diagnostics: ["app_server_stdio is unavailable"],
  });
  assert.throws(() => selectCodexTransport({ inputModalities: ["local_audio", "video"] }), {
    name: "CodexCapabilityPreflightError", diagnostics: ["app_server_stdio lacks input:local_audio, input:video"],
  });
});

test("sanitizes transport errors and interrupts work after normalization failure", async () => {
  const client = JsonRpcStdioClient.spawn({ command: process.execPath, args: [fixture] });
  const transport = new CodexAppServerTransport(client);
  const diagnostics: Error[] = [];
  const adapter = new CanonicalCodexAdapter(new CodexAdapter([transport]), {
    onLocalDiagnostic: (error) => diagnostics.push(error),
  });
  try {
    const packet = runtimePacket([{
      type: "text", partId: "part-1", text: "UNKNOWN WAIT",
    }]);
    const session = await adapter.startSession({
      packet,
      sessionId: packet.attemptId,
      requirements: {
        preferredTransport: "app_server_stdio",
      },
    });
    const events = [];
    for await (const event of adapter.sendTurn(session)) events.push(event);
    const terminal = events.find((event) => event.type === "terminal");
    assert.ok(terminal?.type === "terminal");
    assert.equal(terminal.summary, "Codex transport interrupted before a terminal result");
    assert.equal(terminal.summary.includes("/Users/private"), false);
    assert.equal(diagnostics.some((error) => error.message.includes("/Users/private")), true);
    const state = await client.request("debug/state") as { interruptCount: number };
    assert.equal(state.interruptCount, 1);
    await adapter.close(session);
  } finally {
    await transport.closeProcess();
  }
});

test("keeps the client usable when native completion races normalization failure", async () => {
  const client = JsonRpcStdioClient.spawn({ command: process.execPath, args: [fixture] });
  const transport = new CodexAppServerTransport(client);
  const adapter = new CanonicalCodexAdapter(new CodexAdapter([transport]));
  try {
    const packet = runtimePacket([{
      type: "text", partId: "part-1", text: "UNKNOWN TERMINAL_QUEUED",
    }]);
    const session = await adapter.startSession({
      packet,
      sessionId: packet.attemptId,
      requirements: {
        preferredTransport: "app_server_stdio",
      },
    });
    const events = [];
    for await (const event of adapter.sendTurn(session)) events.push(event);
    assert.equal(events.at(-1)?.type, "terminal");
    const state = await client.request("debug/state") as { interruptCount: number };
    // Separate stdio writes can deliver the failure before native completion.
    assert.ok(state.interruptCount <= 1);
    await adapter.close(session);
  } finally {
    await transport.closeProcess();
  }
});

test("surfaces a malformed warning as an interrupted canonical terminal", async () => {
  const client = JsonRpcStdioClient.spawn({ command: process.execPath, args: [fixture] });
  const transport = new CodexAppServerTransport(client);
  const diagnostics: Error[] = [];
  const adapter = new CanonicalCodexAdapter(new CodexAdapter([transport]), {
    onLocalDiagnostic: (error) => diagnostics.push(error),
  });
  try {
    const packet = runtimePacket([{
      type: "text", partId: "part-1", text: "MALFORMED_WARNING",
    }]);
    const session = await adapter.startSession({
      packet,
      sessionId: packet.attemptId,
      requirements: {
        preferredTransport: "app_server_stdio",
      },
    });
    const events = [];
    for await (const event of adapter.sendTurn(session)) events.push(event);
    const terminal = events.find((event) => event.type === "terminal");
    assert.ok(terminal?.type === "terminal");
    assert.equal(terminal.outcome, "interrupted");
    assert.equal(terminal.errorCode, "worker_interrupted");
    assert.equal(diagnostics.some((error) => error.message.includes("params.message")), true);
    await adapter.close(session);
  } finally {
    await transport.closeProcess();
  }
});
