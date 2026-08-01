import assert from "node:assert/strict";
import test from "node:test";
import {
  isMcpAuthenticationError,
  safeApiKeyHeader,
  safeMcpEndpoint,
  serializeBoundedMcpResult,
  unsupportedServerMessage,
} from "../mcp/policy";
import { resolveAllowedResourceUri } from "../mcp/resource_policy";

test("MCP SDK HTTP authentication challenges are recognized structurally", () => {
  assert.equal(isMcpAuthenticationError({
    name: "SdkHttpError",
    code: "CLIENT_HTTP_AUTHENTICATION",
    status: 401,
  }), true);
  assert.equal(isMcpAuthenticationError({ cause: { statusCode: 401 } }), true);
  assert.equal(isMcpAuthenticationError({ code: "CLIENT_HTTP_ERROR", status: 500 }), false);
});

test("MCP endpoint policy accepts only public-shaped default-port HTTPS URLs", () => {
  assert.deepEqual(safeMcpEndpoint("https://mcp.example.com/api"), {
    endpoint: "https://mcp.example.com/api",
    origin: "https://mcp.example.com",
    host: "mcp.example.com",
  });
  for (const endpoint of [
    "http://mcp.example.com",
    "https://user:secret@mcp.example.com",
    "https://mcp.example.com:8443",
    "https://localhost/mcp",
    "https://127.0.0.1/mcp",
    "https://10.0.0.4/mcp",
    "https://192.168.1.1/mcp",
    "https://[::1]/mcp",
  ]) {
    assert.throws(() => safeMcpEndpoint(endpoint), endpoint);
  }
});

test("MCP API key headers cannot override routing or proxy headers", () => {
  assert.equal(safeApiKeyHeader("X-Example-Key"), "x-example-key");
  for (const header of ["authorization", "mcp-method", "x-forwarded-for", "host", "bad header"]) {
    assert.throws(() => safeApiKeyHeader(header), header);
  }
});

test("unsupported MCP explanation names the supported architecture", () => {
  const message = unsupportedServerMessage();
  assert.match(message, /HTTPS MCP servers/i);
  assert.match(message, /2026-07-28/);
  assert.match(message, /stateless/i);
});

test("MCP result limit counts UTF-8 bytes", () => {
  assert.doesNotThrow(() => serializeBoundedMcpResult({ text: "a".repeat(250_000) }));
  assert.throws(
    () => serializeBoundedMcpResult({ text: "😀".repeat(70_000) }),
    /MCP_RESULT_TOO_LARGE/,
  );
});

test("MCP resource reads stay within the allowed catalog item", () => {
  assert.equal(
    resolveAllowedResourceUri(
      "resource",
      { uri: "docs://approved" },
      "docs://unapproved",
    ),
    "docs://approved",
  );
  assert.equal(
    resolveAllowedResourceUri(
      "resource_template",
      { uriTemplate: "docs://users/{user}/items/{item}" },
      "docs://users/alice/items/42",
    ),
    "docs://users/alice/items/42",
  );
  assert.equal(
    resolveAllowedResourceUri(
      "resource_template",
      { uriTemplate: "docs://search{?q,limit}" },
      undefined,
      { q: "cats and dogs", limit: "5" },
    ),
    "docs://search?q=cats%20and%20dogs&limit=5",
  );
  assert.throws(() => resolveAllowedResourceUri(
    "resource_template",
    { uriTemplate: "docs://users/{user}/items/{item}" },
    "docs://admin/secrets",
  ));
  assert.throws(() => resolveAllowedResourceUri(
    "resource_template",
    { uriTemplate: "docs://search{?q}" },
    undefined,
    { q: { nested: "not supported" } },
  ));
});
