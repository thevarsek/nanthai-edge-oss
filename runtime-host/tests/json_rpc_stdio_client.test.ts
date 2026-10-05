import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { JsonRpcStdioClient } from "../src/json_rpc_stdio_client.ts";

const fixture = fileURLToPath(new URL("./fixtures/fake_json_rpc_child.mjs", import.meta.url));

test("correlates responses and handles a server request", async () => {
  const client = JsonRpcStdioClient.spawn({ command: process.execPath, args: [fixture] });
  client.onMessage((message) => {
    if ("id" in message) client.respond(message.id, { decision: "decline" });
  });
  try {
    assert.deepEqual(await client.request("echo", { value: 42 }), { value: 42 });
    assert.deepEqual(await client.request("ask-client"), { decision: "decline" });
  } finally {
    await client.close();
  }
});

test("fails pending requests on malformed child output", async () => {
  const client = JsonRpcStdioClient.spawn({ command: process.execPath, args: [fixture] });
  try {
    await assert.rejects(client.request("malformed"), /Unexpected token|JSON/);
  } finally {
    await client.close();
  }
});
