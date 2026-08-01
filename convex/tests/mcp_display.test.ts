import assert from "node:assert/strict";
import test from "node:test";

import {
  mcpActiveConnectionOption,
  mcpCatalogCounts,
  mcpCatalogItemDisplayName,
  mcpConnectionDisplayName,
} from "../mcp/display";

test("Remote MCP active connection options include the public connection id", () => {
  assert.deepEqual(mcpActiveConnectionOption({
    publicId: "mcp_connection_1",
    integrationId: "mcp:cloudflare-docs",
    friendlyName: "My Cloudflare docs",
    serverName: "Cloudflare docs",
    endpointHost: "docs.mcp.cloudflare.com",
  }, 3), {
    connectionId: "mcp_connection_1",
    integrationId: "mcp:cloudflare-docs",
    displayName: "My Cloudflare docs",
    friendlyName: "My Cloudflare docs",
    serverName: "Cloudflare docs",
    endpointHost: "docs.mcp.cloudflare.com",
    allowedItemCount: 3,
  });
});

test("Remote MCP connection display name prefers user, server, then host", () => {
  assert.equal(mcpConnectionDisplayName({
    friendlyName: "My docs",
    serverName: "Cloudflare",
    endpointHost: "docs.example.com",
  }), "My docs");
  assert.equal(mcpConnectionDisplayName({
    serverName: "Cloudflare",
    endpointHost: "docs.example.com",
  }), "Cloudflare");
  assert.equal(mcpConnectionDisplayName({ endpointHost: "docs.example.com" }), "docs.example.com");
});

test("Remote MCP item display name prefers title and humanizes its protocol name", () => {
  assert.equal(mcpCatalogItemDisplayName({
    title: "Search Cloudflare documentation",
    remoteName: "search_cloudflare_documentation",
  }), "Search Cloudflare documentation");
  assert.equal(mcpCatalogItemDisplayName({
    remoteName: "search_cloudflare_documentation",
  }), "Search Cloudflare Documentation");
});

test("Remote MCP catalog projections include native-client item counts", () => {
  assert.deepEqual(mcpCatalogCounts([
    { decision: "allowed" },
    { decision: "disabled" },
    { decision: "allowed" },
  ]), {
    itemCount: 3,
    allowedItemCount: 2,
  });
});
