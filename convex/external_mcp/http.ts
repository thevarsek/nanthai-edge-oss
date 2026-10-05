import { z } from "zod";
import { httpAction, type ActionCtx } from "../_generated/server";
import type { HttpRouter } from "convex/server";
import { internal } from "../_generated/api";
import { MCP_SCOPES } from "./policy";
import { findTool, toolsForScopes } from "./tools";

const headers = { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "WWW-Authenticate" };
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(body, { status, headers: { ...headers, ...extra } });
const rpcSchema = z.object({ jsonrpc: z.literal("2.0"), id: z.union([z.string(), z.number()]).optional(), method: z.string(), params: z.record(z.string(), z.unknown()).optional() });
const registration = z.object({ client_name: z.string().optional(), redirect_uris: z.array(z.string()), token_endpoint_auth_method: z.literal("none").optional() });
function issuer(): string { return process.env.CONVEX_SITE_URL ?? ""; }
function failure(error: unknown): string {
  const data = error && typeof error === "object" && "data" in error ? error.data : undefined;
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") return data.error;
  // Convex HTTP action wrappers can stringify ConvexError data across internal calls.
  const message = error instanceof Error ? error.message : "";
  for (const code of ["insufficient_scope", "invalid_token", "invalid_grant", "invalid_scope", "invalid_request", "invalid_target", "unsupported_grant_type", "invalid_redirect_uri"])
    if (message.includes(`"${code}"`)) return code;
  return "invalid_request";
}
function authFailure(error: string): Response {
  return json({ error }, error === "insufficient_scope" ? 403 : 401, {
    "WWW-Authenticate": `Bearer resource_metadata="${issuer()}/.well-known/oauth-protected-resource/mcp", error="${error}"`,
  });
}
async function oauthHttp(ctx: ActionCtx, request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (url.pathname === "/oauth/register") {
      const body = registration.parse(await request.json());
      return json(await ctx.runMutation(internal.external_mcp.oauth.registerClient, { name: body.client_name ?? "MCP client", redirectUris: body.redirect_uris }), 201);
    }
    if (url.pathname === "/oauth/authorize") {
      const params = url.searchParams;
      if (params.get("response_type") !== "code" || params.get("code_challenge_method") !== "S256") return json({ error: "invalid_request" }, 400);
      const pending = await ctx.runMutation(internal.external_mcp.oauth.begin, {
        clientId: params.get("client_id") ?? "", redirectUri: params.get("redirect_uri") ?? "", resource: params.get("resource") ?? `${issuer()}/mcp`,
        challenge: params.get("code_challenge") ?? "", scope: params.get("scope") ?? MCP_SCOPES.join(" "),
        ...(params.has("state") ? { state: params.get("state") ?? "" } : {}),
      });
      const consent = new URL("/mcp/authorize", process.env.NANTHAI_WEB_URL ?? "https://nanthai.tech");
      consent.searchParams.set("request", pending);
      return new Response(null, { status: 302, headers: { ...headers, Location: consent.href } });
    }
    const form = new URLSearchParams(await request.text());
    const optional = (key: string) => form.has(key) ? form.get(key) ?? "" : undefined;
    return json(await ctx.runMutation(internal.external_mcp.oauth.exchange, { grantType: form.get("grant_type") ?? "", clientId: form.get("client_id") ?? "",
      code: optional("code"), verifier: optional("code_verifier"), redirectUri: optional("redirect_uri"), refreshToken: optional("refresh_token"), resource: optional("resource"), scope: optional("scope") }));
  } catch (error) { return json({ error: failure(error) }, 400); }
}

export async function mcpHttp(ctx: ActionCtx, request: Request): Promise<Response> {
  const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("Authorization") ?? "")?.[1];
  if (!token) return authFailure("invalid_token");
  let tools: ReturnType<typeof toolsForScopes>;
  try { tools = JSON.parse(await ctx.runQuery(internal.external_mcp.dispatch.discover, { accessToken: token })); }
  catch (error) { return authFailure(failure(error)); }
  let rpc;
  try { rpc = rpcSchema.parse(await request.json()); }
  catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON-RPC request" } }, 400); }
  if (rpc.id === undefined) return new Response(null, { status: 202, headers });
  const reply = (result: unknown) => json({ jsonrpc: "2.0", id: rpc.id, result });
  if (rpc.method === "initialize") return reply({ protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "NanthAI", version: "1.0.0" }, instructions: "Use the granted tools to work with your NanthAI account. Reuse callId and identical arguments when retrying writes. Accepted model work runs asynchronously; read_chat follows the saved result. Revocation stops new access; use stop_run to cancel accepted work." });
  if (rpc.method === "ping") return reply({});
  if (rpc.method === "tools/list") return reply({ tools });
  if (rpc.method !== "tools/call") return json({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "Method not found" } });
  const tool = findTool(String(rpc.params?.name));
  if (!tool) return reply({ content: [{ type: "text", text: "Unknown tool" }], isError: true });
  let storageId;
  try {
    const input = tool.schema.parse(rpc.params?.arguments ?? {});
    // Recheck the grant in the consequential mutation, including concurrent revocation.
    // Publication storage is staged here and deleted on replay or failed commit.
    if (tool.name === "nanthai_publish_result") {
      if (!tools.some(item => item.name === tool.name)) return authFailure("insufficient_scope");
      const result = input as { content: string; mimeType: string };
      storageId = await ctx.storage.store(new Blob([result.content], { type: result.mimeType }));
    }
    const call = { accessToken: token, tool: tool.name, inputJson: JSON.stringify(input) };
    const result = tool.readOnly ? await ctx.runQuery(internal.external_mcp.dispatch.read, call)
      : await ctx.runMutation(internal.external_mcp.dispatch.write, { ...call, ...(storageId ? { storageId } : {}) });
    return reply({ content: [{ type: "text", text: result }] });
  } catch (error) {
    if (storageId) await ctx.storage.delete(storageId);
    const code = failure(error);
    if (code === "invalid_token" || code === "insufficient_scope") return authFailure(code);
    const data = error && typeof error === "object" && "data" in error ? error.data : null;
    const message = data && typeof data === "object" && "message" in data ? String(data.message) : "The request could not be completed. Check the arguments and the task’s normal readiness in NanthAI.";
    return reply({ content: [{ type: "text", text: message }], isError: true });
  }
}
export function registerExternalMcpHttp(http: HttpRouter): void {
  http.route({ path: "/mcp", method: "POST", handler: httpAction(mcpHttp) });
  for (const method of ["GET", "DELETE"] as const) http.route({ path: "/mcp", method, handler: httpAction(async () => json({ error: "method_not_allowed" }, 405, { Allow: "POST, OPTIONS" })) });
  const options = httpAction(async () => new Response(null, { status: 204, headers: { ...headers, "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id" } }));
  for (const path of ["/mcp", "/oauth/register", "/oauth/token", "/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-authorization-server"]) http.route({ path, method: "OPTIONS", handler: options });
  http.route({ path: "/.well-known/oauth-protected-resource/mcp", method: "GET", handler: httpAction(async () => json({ resource: `${issuer()}/mcp`, authorization_servers: [issuer()], scopes_supported: MCP_SCOPES, bearer_methods_supported: ["header"], resource_name: "NanthAI" })) });
  http.route({ path: "/.well-known/oauth-authorization-server", method: "GET", handler: httpAction(async () => json({ issuer: issuer(), authorization_endpoint: `${issuer()}/oauth/authorize`, token_endpoint: `${issuer()}/oauth/token`, registration_endpoint: `${issuer()}/oauth/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: MCP_SCOPES })) });
  for (const [path, method] of [["/oauth/register", "POST"], ["/oauth/authorize", "GET"], ["/oauth/token", "POST"]] as const) http.route({ path, method, handler: httpAction(oauthHttp) });
}
