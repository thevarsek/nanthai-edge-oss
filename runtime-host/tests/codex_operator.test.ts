import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CodexAppServerOperator } from "../src/codex_app_server_operator.ts";

const fakeServer = fileURLToPath(
  new URL("./fixtures/fake_json_rpc_child.mjs", import.meta.url),
);

test("operator reports safe App Server account, models, and rate limits", async () => {
  const result = await new CodexAppServerOperator({
    command: process.execPath,
    args: [fakeServer],
  }).inspect();
  assert.equal(result.healthy, true);
  assert.equal(result.transport, "stdio");
  assert.equal(result.account.authMethod, "chatgpt");
  assert.equal(result.account.identity, "personal@example.test");
  assert.equal(result.account.plan, "pro");
  assert.equal(result.modelCount, 1);
  assert.equal(result.rateLimits?.primary?.usedPercent, 12);
  assert.equal(result.rateLimitReadError, null);
});
