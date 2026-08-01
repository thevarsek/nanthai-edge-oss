import assert from "node:assert/strict";
import test from "node:test";
import { convexToJson } from "convex/values";
import {
  boundedCatalogJson,
  mcpDiscoveryErrorCode,
  normalizedCatalog,
  stableCatalogKey,
  stableToolAlias,
  uniqueCatalogItems,
  type CatalogItem,
} from "../mcp/catalog";
import { statusAfterCatalogRefresh } from "../mcp/catalog_mutations";
import { jsonForMcpStorage, mcpJsonFromStorage } from "../mcp/json_codec";

test("MCP catalog values are normalized to Convex-safe JSON", () => {
  const normalized = jsonForMcpStorage({
    name: "search",
    title: undefined,
    schema: {
      type: "object",
      optional: undefined,
      variants: ["text", undefined],
    },
  });

  assert.deepEqual(normalized, {
    name: "search",
    schema: {
      type: "object",
      variants: ["text", null],
    },
  });
});

test("MCP catalog JSON preserves keys that Convex reserves", () => {
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    properties: {
      "città": { type: "string" },
    },
  };
  const stored = jsonForMcpStorage(schema);

  assert.doesNotThrow(() => convexToJson(stored as never));
  assert.deepEqual(mcpJsonFromStorage(stored), schema);
});

test("MCP discovery diagnostics expose only allowlisted stages", () => {
  assert.equal(mcpDiscoveryErrorCode(new Error("MCP_CATALOG_PERSIST_FAILED")), "MCP_CATALOG_PERSIST_FAILED");
  assert.equal(mcpDiscoveryErrorCode(new Error("provider response contained a token")), undefined);
  assert.equal(mcpDiscoveryErrorCode({ message: "MCP_CATALOG_READ_FAILED" }), undefined);
});

test("MCP catalog rejects schema depth, node-count, and byte bombs", () => {
  let nested: unknown = { type: "string" };
  for (let index = 0; index < 30; index += 1) nested = { child: nested };
  assert.equal(boundedCatalogJson(nested).tooLarge, true);

  const manyNodes = Array.from({ length: 4_200 }, (_, index) => ({ index }));
  assert.equal(boundedCatalogJson(manyNodes).tooLarge, true);
  assert.equal(boundedCatalogJson({ type: "string", description: "x".repeat(70_000) }).tooLarge, true);
  assert.deepEqual(boundedCatalogJson({ type: "object", properties: {} }), {
    value: { type: "object", properties: {} },
    tooLarge: false,
  });
});

test("MCP catalog refresh preserves an explicit server enablement decision", () => {
  assert.equal(statusAfterCatalogRefresh("active"), "active");
  assert.equal(statusAfterCatalogRefresh("disabled"), "disabled");
  assert.equal(statusAfterCatalogRefresh("validating"), "reviewing");
  assert.equal(statusAfterCatalogRefresh("auth_required"), "reviewing");
});

test("MCP catalog stable keys remain distinct after bounding and duplicates collapse", () => {
  const sharedPrefix = "https://example.com/" + "a".repeat(600);
  const firstKey = stableCatalogKey("resource", `${sharedPrefix}/one`);
  const secondKey = stableCatalogKey("resource", `${sharedPrefix}/two`);
  assert.equal(firstKey.length, 512);
  assert.equal(secondKey.length, 512);
  assert.notEqual(firstKey, secondKey);

  const item: CatalogItem = {
    kind: "tool",
    remoteName: "duplicate",
    stableKey: "tool:duplicate",
    definitionHash: "hash",
  };
  assert.deepEqual(uniqueCatalogItems([item, { ...item }]), [item]);
});

test("MCP tool aliases are stable, provider-safe, and resist normalized-name collisions", () => {
  const first = stableToolAlias("018f-test-connection", "Create issue / urgent");
  const repeated = stableToolAlias("018f-test-connection", "Create issue / urgent");
  const punctuationEquivalent = stableToolAlias(
    "018f-test-connection",
    "Create issue - urgent",
  );
  assert.equal(first, repeated);
  assert.notEqual(first, punctuationEquivalent);
  assert.match(first, /^mcp_[a-z0-9_]+$/);
  assert.ok(first.length <= 64);
});

test("MCP resource templates expose variables and disable malformed syntax", () => {
  const baseCatalog = {
    tools: [],
    prompts: [],
    resources: [],
    serverInfo: {},
    capabilities: {},
    instructions: undefined,
    extensions: undefined,
  };
  const valid = normalizedCatalog("connection", {
    ...baseCatalog,
    resourceTemplates: [{
      name: "search",
      uriTemplate: "docs://search{?q,limit}",
    }],
  } as never)[0];
  assert.deepEqual(valid.arguments, [
    { name: "q", title: "q", required: true },
    { name: "limit", title: "limit", required: true },
  ]);
  assert.equal(valid.disabledReason, undefined);

  const malformed = normalizedCatalog("connection", {
    ...baseCatalog,
    resourceTemplates: [{ name: "broken", uriTemplate: "docs://search{" }],
  } as never)[0];
  assert.equal(malformed.disabledReason, "INVALID_URI_TEMPLATE");
});
