import assert from "node:assert/strict";
import test from "node:test";
import { resultBridge } from "../src/result_bridge.ts";
import { runtimePacket } from "./fixtures/runtime_packet.ts";

test("publication reports failure honestly, retries the same payload, and never publishes after local cancellation", async (t) => {
  const packet = runtimePacket();
  packet.capabilities.nanthaiTools = [{ id: "nanthai_publish_result", name: "Publish", version: "1", effect: "write", inputSchemaHash: "a".repeat(64) }];
  const bodies: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    bodies.push(String(init.body));
    if (bodies.length === 1) throw new Error("Connection lost after dispatch");
    return new Response(JSON.stringify({ generatedFileId: "file-1", storageId: "blob-1", filename: "answer.md", url: "https://example.test/file-1" }));
  });
  const bridge = resultBridge({ deviceId: "device-1", credentialId: "credential-1", credential: "test-secret", controlPlaneUrl: "https://example.test" }, "presence-1");
  const request = { callId: "call-1", tool: "nanthai_publish_result", arguments: { filename: "answer.md", mimeType: "text/markdown", content: "Answer" } };
  const controller = new AbortController();
  await assert.rejects(bridge(request, packet, controller.signal), /could not be reached/);
  assert.equal(JSON.parse(await bridge(request, packet, controller.signal)).published, true);
  assert.equal(bodies[0], bodies[1]);
  assert.doesNotMatch(bodies[0]!, /test-secret/);
  controller.abort();
  await assert.rejects(bridge(request, packet, controller.signal));
  assert.equal(bodies.length, 2);
});
