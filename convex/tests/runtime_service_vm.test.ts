import assert from "node:assert/strict";
import test from "node:test";

import { resolvePersistentRuntimeWorkspacePath } from "../runtime/service_vm";

test("resolvePersistentRuntimeWorkspacePath resolves relative paths inside the workspace", () => {
  const resolved = resolvePersistentRuntimeWorkspacePath(
    "outputs/report.pdf",
    "/tmp/nanthai-edge/chat_1/vm-python",
  );

  assert.equal(resolved, "/tmp/nanthai-edge/chat_1/vm-python/outputs/report.pdf");
});

test("resolvePersistentRuntimeWorkspacePath rejects paths outside the workspace", () => {
  assert.throws(
    () =>
      resolvePersistentRuntimeWorkspacePath(
        "../../etc/passwd",
        "/tmp/nanthai-edge/chat_1/vm-python",
      ),
    /outside the persistent VM workspace/i,
  );
});

test("resolvePersistentRuntimeWorkspacePath rejects deleting the workspace root", () => {
  assert.throws(
    () =>
      resolvePersistentRuntimeWorkspacePath(
        "/tmp/nanthai-edge/chat_1/vm-python",
        "/tmp/nanthai-edge/chat_1/vm-python",
      ),
    /workspace root/i,
  );
});
