import assert from "node:assert/strict";
import test from "node:test";
import { mcpOperationInputHash } from "../mcp/operation_hash";

test("MCP operation journals retain only a digest of elicited input", () => {
  const secret = "user-entered-secret";
  const digest = mcpOperationInputHash({ inputResponses: { verification: secret } });

  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(digest, new RegExp(secret));
});
