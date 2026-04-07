import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { Sandbox } from "@e2b/code-interpreter";

import {
  assertE2BConfigured,
  connectE2BSandbox,
  createE2BSandbox,
  killE2BSandbox,
} from "../runtime/e2b_client";
import {
  RUNTIME_TEMPLATE_NAME,
  RUNTIME_TIMEOUT_MS,
} from "../runtime/shared";

test("assertE2BConfigured rejects when the API key is missing", () => {
  const original = process.env.E2B_API_KEY;
  delete process.env.E2B_API_KEY;
  try {
    assert.throws(() => assertE2BConfigured(), /E2B_API_KEY is not configured/);
  } finally {
    process.env.E2B_API_KEY = original;
  }
});

test("createE2BSandbox and connectE2BSandbox use the shared runtime configuration", async (t) => {
  t.after(() => {
    mock.restoreAll();
    process.env.E2B_API_KEY = "test-key";
  });

  process.env.E2B_API_KEY = "test-key";
  const createCalls: unknown[] = [];
  const connectCalls: unknown[] = [];

  mock.method(Sandbox, "create", async (...args: unknown[]) => {
    createCalls.push(args);
    return { sandboxId: "sandbox_new" } as any;
  });
  mock.method(Sandbox, "connect", async (...args: unknown[]) => {
    connectCalls.push(args);
    return { sandboxId: "sandbox_existing", kill: async () => undefined } as any;
  });

  const created = await createE2BSandbox({ userId: "user_1", chatId: "chat_1" });
  const connected = await connectE2BSandbox("sandbox_existing");

  assert.equal((created as any).sandboxId, "sandbox_new");
  assert.equal((connected as any).sandboxId, "sandbox_existing");
  assert.deepEqual(createCalls[0], [
    RUNTIME_TEMPLATE_NAME,
    {
      timeoutMs: RUNTIME_TIMEOUT_MS,
      secure: true,
      allowInternetAccess: true,
      metadata: { userId: "user_1", chatId: "chat_1" },
      lifecycle: {
        onTimeout: "pause",
        autoResume: false,
      },
    },
  ]);
  assert.deepEqual(connectCalls[0], [
    "sandbox_existing",
    { timeoutMs: RUNTIME_TIMEOUT_MS },
  ]);
});

test("killE2BSandbox connects and kills the sandbox", async (t) => {
  t.after(() => {
    mock.restoreAll();
    process.env.E2B_API_KEY = "test-key";
  });

  process.env.E2B_API_KEY = "test-key";
  const killCalls: string[] = [];

  mock.method(Sandbox, "connect", async () => ({
    kill: async () => {
      killCalls.push("killed");
    },
  }) as any);

  await killE2BSandbox("sandbox_dead");

  assert.deepEqual(killCalls, ["killed"]);
});
