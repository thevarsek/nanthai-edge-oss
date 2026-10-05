import assert from "node:assert/strict";
import test from "node:test";
import { dynamicToolResponse } from "../src/transports/app_server_tool_bridge.ts";
import { resultBridge } from "../src/result_bridge.ts";
import { runtimePacket } from "./fixtures/runtime_packet.ts";

test("Codex context read returns the App Server success envelope, not raw JSON", async () => {
  const packet = runtimePacket();
  packet.capabilities.nanthaiTools = [{ id: "nanthai_read_context", name: "nanthai_read_context",
    version: "1", effect: "read", inputSchemaHash: "a".repeat(64) }];
  const bridge = resultBridge({ deviceId: "device", credentialId: "credential",
    credential: "test-only", controlPlaneUrl: "http://127.0.0.1:9" }, "presence");
  const result = await dynamicToolResponse({ callId: "read", tool: "nanthai_read_context", arguments: {} },
    value => bridge(value, packet, new AbortController().signal)) as {
      success: boolean; contentItems: Array<{ type: string; text: string }>;
    };
  assert.equal(result.success, true);
  assert.equal(result.contentItems.length, 1);
  const [item] = result.contentItems;
  assert.ok(item);
  assert.equal(item.type, "inputText");
  assert.deepEqual(JSON.parse(item.text), {
    ...packet.context, messageIds: packet.messages.map(message => message.messageId),
  });
});

test("Codex tool failures retain the protocol envelope and do not become success", async () => {
  const result = await dynamicToolResponse({}, async () => { throw new Error("read failed"); });
  assert.deepEqual(result, { success: false, contentItems: [{ type: "inputText", text: "read failed" }] });
  const missing = await dynamicToolResponse({}, undefined);
  assert.deepEqual(missing, { success: false, contentItems: [{ type: "inputText", text: "NanthAI capability bridge is unavailable" }] });
});
