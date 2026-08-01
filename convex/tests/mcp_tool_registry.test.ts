import assert from "node:assert/strict";
import test from "node:test";
import { jsonForMcpStorage } from "../mcp/json_codec";
import { registerRemoteMcpTools } from "../mcp/tool_registry";
import { remoteMcpToolCallDisplayMetadata } from "../mcp/chat_registry";
import { ToolRegistry } from "../tools/registry";

test("Remote MCP tools expose decoded JSON Schema in the V8-safe registry", () => {
  const registry = new ToolRegistry();
  registerRemoteMcpTools(registry, [{
    connectionId: "connection-1",
    integrationId: "mcp:connection-1",
    integrationName: "Documentation",
    stableKey: "tool:search",
    remoteName: "search",
    displayName: "Search documentation",
    alias: "mcp_connection_search",
    description: "Search the remote documentation.",
    inputSchema: jsonForMcpStorage({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    }),
  }]);

  assert.deepEqual(registry.getDefinitions(), [{
    type: "function",
    function: {
      name: "mcp_connection_search",
        description: "[Remote MCP: Documentation] Search the remote documentation.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  }]);
});

test("Remote MCP tools expose friendly persisted chat display metadata", () => {
  assert.deepEqual(remoteMcpToolCallDisplayMetadata([{
    connectionId: "connection-1",
    integrationId: "mcp:connection-1",
    integrationName: "Cloudflare Docs",
    stableKey: "tool:search",
    remoteName: "search_cloudflare_documentation",
    displayName: "Search Cloudflare documentation",
    alias: "mcp_connection_search",
  }]), {
    mcp_connection_search: {
      source: "remote_mcp",
      displayName: "Search Cloudflare documentation",
      integrationId: "mcp:connection-1",
      integrationName: "Cloudflare Docs",
    },
  });
});

test("Remote MCP registry and display metadata resolve legacy alias collisions consistently", () => {
  const registry = new ToolRegistry();
  const definitions = [
    {
      connectionId: "connection-1",
      integrationId: "mcp:connection-1",
      integrationName: "First server",
      stableKey: "tool:first",
      remoteName: "first",
      displayName: "First tool",
      alias: "mcp_legacy_collision",
      description: "First description",
    },
    {
      connectionId: "connection-2",
      integrationId: "mcp:connection-2",
      integrationName: "Second server",
      stableKey: "tool:second",
      remoteName: "second",
      displayName: "Second tool",
      alias: "mcp_legacy_collision",
      description: "Second description",
    },
  ];

  registerRemoteMcpTools(registry, definitions);

  const registered = registry.getDefinitions()[0];
  assert.equal(registered?.type, "function");
  if (registered?.type === "function") {
    assert.match(registered.function.description ?? "", /First description/);
  }
  assert.deepEqual(remoteMcpToolCallDisplayMetadata(definitions), {
    mcp_legacy_collision: {
      source: "remote_mcp",
      displayName: "First tool",
      integrationId: "mcp:connection-1",
      integrationName: "First server",
    },
  });
});
