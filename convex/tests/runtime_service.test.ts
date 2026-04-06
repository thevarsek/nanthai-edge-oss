import assert from "node:assert/strict";
import test from "node:test";

import { ensureWorkspaceDirectories } from "../runtime/service";

test("ensureWorkspaceDirectories creates each workspace directory individually", async () => {
  const calls: string[] = [];
  const sandbox = {
    files: {
      makeDir: async (path: string) => {
        calls.push(path);
        return true;
      },
    },
  };

  const workspace = await ensureWorkspaceDirectories(sandbox, "chat_123");

  assert.deepEqual(calls, [
    "/tmp/nanthai-edge/chat_123",
    "/tmp/nanthai-edge/chat_123/inputs",
    "/tmp/nanthai-edge/chat_123/outputs",
    "/tmp/nanthai-edge/chat_123/charts",
  ]);
  assert.equal(workspace.root, "/tmp/nanthai-edge/chat_123");
  assert.equal(workspace.inputs, "/tmp/nanthai-edge/chat_123/inputs");
  assert.equal(workspace.outputs, "/tmp/nanthai-edge/chat_123/outputs");
  assert.equal(workspace.charts, "/tmp/nanthai-edge/chat_123/charts");
});
