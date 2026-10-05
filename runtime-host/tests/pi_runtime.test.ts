import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { RuntimeWorkerExecutor } from "../src/codex_command_executor.ts";
import { OwnedProcess } from "../src/process_tree.ts";
import { PiRpcClient } from "../src/pi_rpc_client.ts";
import { PiWorkerBackend } from "../src/pi_worker_backend.ts";
import { computePacketHash } from "../src/packet_integrity.ts";
import { BRIDGE_TOOLS, type AdapterEvent } from "../src/protocol.ts";
import type { RuntimeCommand, RuntimeEvent } from "../src/control_plane.ts";
import { runtimePartPath } from "../src/runtime_part_paths.ts";
import { fetchedPartBase, runtimePacket } from "./fixtures/runtime_packet.ts";

const fixture = fileURLToPath(new URL("./fixtures/fake_pi.mjs", import.meta.url));
function packet(text: string) {
  const value = runtimePacket([{ type: "text", partId: "text-1", text }]);
  value.placement.adapter = { adapterId: "pi", adapterVersion: "1.0.0" };
  value.command.packetHash = computePacketHash(value);
  return value;
}

test("Pi JSONL preserves Unicode separators and correlates concurrent responses", async () => {
  const client = PiRpcClient.spawn({ command: process.execPath, args: [fixture] });
  try {
    const values = await Promise.all([client.request("echo", { text: "a\u2028b\u2029c" }), client.request("get_state")]);
    assert.deepEqual(values[0], { text: "a\u2028b\u2029c" });
    assert.equal(typeof values[1], "object");
    await assert.rejects(client.request("unknown"), /rejected/);
  } finally { await client.close(); }
});

test("Pi prompt acknowledgement may wait for a native dialog beyond the RPC command timeout", async () => {
  const client = new PiRpcClient(OwnedProcess.spawn({ command: process.execPath, args: [fixture] }), 5);
  try {
    const answer = new Promise<void>(resolve => client.onEvent(event => {
      if (event.type !== "extension_ui_request") return;
      setTimeout(() => { client.write({ type: "extension_ui_response", id: event.id, value: "Blue" }); resolve(); }, 25);
    }));
    const result = await client.request("prompt", { message: "ASK" });
    await answer;
    assert.deepEqual(result, { disposition: "started" });
  } finally { await client.close(); }
});

test("Pi native question roundtrip settles after agent_end and keeps a resumable frontier", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanthai-pi-test-"));
  const config = { command: process.execPath, args: [fixture], sessionDirectory: directory };
  const backend = new PiWorkerBackend(config);
  const value = packet("ASK");
  let nativeId = ""; let frontier = "";
  try {
    const opened = await backend.open(value, value.attemptId, null);
    nativeId = backend.nativeSessionId(opened.session);
    const events: AdapterEvent[] = [];
    for await (const event of backend.sendTurn(opened.session)) {
      events.push(event);
      if (event.type === "input_requested") {
        assert.equal(event.source, "adapter_native");
        assert.equal(event.requestSchema.isBlocking, true);
        await assert.rejects(backend.respondToInput(opened.session, event.inputRequestId, { outcome: "submitted", content: { value: "Red" } }));
        const resolved = await backend.respondToInput(opened.session, event.inputRequestId, { outcome: "submitted", content: { value: "Blue" } });
        assert.equal(resolved.type, "input_resolved");
      }
      if (event.type === "terminal") frontier = event.nativeTurnId ?? "";
    }
    assert.ok(frontier);
    assert.equal(events.at(-1)?.type, "terminal");
    assert.ok(events.some(event => event.type === "text_delta" && event.delta === "Blue"));
    const usage = events.find(event => event.type === "usage_reported");
    assert.equal(usage?.type === "usage_reported" && usage.cost.source, "api_equivalent_estimate");
    assert.equal(usage?.type === "usage_reported" && usage.tokens.input, 12);
    assert.equal(usage?.type === "usage_reported" && usage.tokens.cachedInput, 2);
    await backend.close(opened.session);
    const resumed = await backend.open(packet("next"), value.attemptId, nativeId, { expectedNativeTurnId: frontier, deliveredMessageIds: [] });
    assert.equal(resumed.resumed, true);
    await backend.close(resumed.session);
    const reset = await backend.open(packet("changed"), value.attemptId, nativeId, { expectedNativeTurnId: "unowned-leaf" });
    assert.equal(reset.resumed, false);
    assert.equal(reset.replacementReason, "native_frontier_changed");
  } finally { await backend.shutdown(); await rm(directory, { recursive: true, force: true }); }
});

test("Pi uses the canonical worker executor and publishes through the existing bridge", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanthai-pi-executor-"));
  const value = packet("BRIDGE");
  const tool = BRIDGE_TOOLS.find(item => item.name === "nanthai_publish_result")!;
  value.capabilities.nanthaiTools = [{ id: tool.name, name: tool.name, version: "1", effect: "write",
    inputSchemaHash: createHash("sha256").update(JSON.stringify(tool.inputSchema)).digest("hex") }];
  value.command.packetHash = computePacketHash(value);
  const events: RuntimeEvent[] = [];
  let publications = 0;
  const executor = new RuntimeWorkerExecutor({ pi: { command: process.execPath, args: [fixture], sessionDirectory: directory },
    bridgeCall: async request => { assert.equal(request.tool, tool.name); publications++; return "published-file-1"; } });
  const command: RuntimeCommand = {
    commandRecordId: "record-1", commandId: value.command.commandId, runId: value.runId,
    attemptId: value.attemptId, fence: value.fence, kind: "start", receivedAtMs: Date.now(), payload: {
      type: "start", authorizationSource: "paired_device", inputHash: "transport-envelope-hash",
      rawPayload: JSON.stringify({ threadName: "NanthAI · Pi QA" }), turnPacketId: "packet-1",
      packet: value, packetSha256: value.command.packetHash, packetError: null,
    },
  };
  try {
    await executor.execute(command, async event => { events.push(event); }, new AbortController().signal);
    assert.equal(publications, 1);
    assert.equal(executor.activeCount(), 0);
    assert.ok(events.some(event => (event.payload as { kind: string }).kind === "terminal_event"));
    assert.deepEqual(events.map(event => (event.payload as { sequence: number }).sequence), events.map((_, index) => index));
  } finally { await executor.shutdown(); await rm(directory, { recursive: true, force: true }); }
});


test("Pi rejects an image for a text-only selected model before submitting a turn", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanthai-pi-image-"));
  const part = { ...fetchedPartBase(), type: "image" as const, mimeType: "image/png", altText: null };
  const value = runtimePacket([part]);
  value.placement.adapter = { adapterId: "pi", adapterVersion: "1.0.0" };
  value.command.packetHash = computePacketHash(value);
  await writeFile(runtimePartPath(directory, part), Buffer.alloc(part.fetch.byteLength));
  const backend = new PiWorkerBackend({ command: process.execPath, args: [fixture], sessionDirectory: directory,
    attachmentDirectory: directory, environment: { NANTHAI_TEST_TEXT_MODEL: "1" } });
  try { await assert.rejects(backend.open(value, value.attemptId, null), /does not support images/); }
  finally { await backend.shutdown(); await rm(directory, { recursive: true, force: true }); }
});

// Normal provider selection belongs to Pi, including subscription and custom providers.
test("Pi discovers and executes configured subscription and custom providers with usage", async () => {
  for (const provider of ["openai", "anthropic", "custom-local"]) {
    const directory = await mkdtemp(join(tmpdir(), "nanthai-pi-provider-"));
    const backend = new PiWorkerBackend({ command: process.execPath, args: [fixture], sessionDirectory: directory,
      environment: { NANTHAI_TEST_PI_PROVIDER: provider } });
    try {
      const models = await backend.canonicalModels();
      assert.equal(models[0]?.provider, provider);
      assert.equal(models[0]?.availability, "available");
      const opened = await backend.open(packet("next"), "session-1", null);
      const events: AdapterEvent[] = [];
      for await (const event of backend.sendTurn(opened.session)) events.push(event);
      const usage = events.find(event => event.type === "usage_reported");
      assert.equal(usage?.type === "usage_reported" && usage.actualModel?.provider, provider);
      assert.equal(usage?.type === "usage_reported" && usage.tokens.total, 17);
      assert.equal(events.at(-1)?.type, "terminal");
    } finally { await backend.shutdown(); await rm(directory, { recursive: true, force: true }); }
  }
});
