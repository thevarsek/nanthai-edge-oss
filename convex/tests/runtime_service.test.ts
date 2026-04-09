import assert from "node:assert/strict";
import test from "node:test";

import { runtimeWorkspacePaths } from "../runtime/shared";

test("runtimeWorkspacePaths returns correct workspace paths for chatId", async () => {
  const workspace = runtimeWorkspacePaths("chat_123");

  assert.equal(workspace.root, "/tmp/nanthai-edge/chat_123");
  assert.equal(workspace.inputs, "/tmp/nanthai-edge/chat_123/inputs");
  assert.equal(workspace.outputs, "/tmp/nanthai-edge/chat_123/outputs");
  assert.equal(workspace.charts, "/tmp/nanthai-edge/chat_123/charts");
});
