import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isAccountActive } from "../lib/account_access";
import { createRuntimeCredential, sha256Hex } from "../runtime_host/security";

// chat:write is text-only. chat:tools adds tools and connected apps; runtime:local
// adds the paired-computer route and requires chat:tools. Both are opt-in.
export const MCP_SCOPES = ["history:read", "chat:write", "chat:tools", "runtime:local", "results:write", "jobs:run", "runs:stop"] as const;
export const OPT_IN_SCOPES: readonly string[] = ["chat:tools", "runtime:local"];
export const ACCESS_MS = 60 * 60_000;
export const CODE_MS = 10 * 60_000;
export const REFRESH_ABSOLUTE_MS = 90 * 24 * 60 * 60_000;
export const REFRESH_IDLE_MS = 30 * 24 * 60 * 60_000;
export const REFRESH_GRACE_MS = 60_000;
export function token(): string { return createRuntimeCredential().replace(/^nrh_/, "nmc_"); }
export function oauthError(error: string): never { throw new ConvexError({ error }); }
export function requestedScopes(raw: string): string[] {
  const scopes = [...new Set(raw.split(" ").filter(Boolean))];
  if (scopes.some(scope => !MCP_SCOPES.includes(scope as typeof MCP_SCOPES[number]))) oauthError("invalid_scope");
  return scopes;
}
/** A granted scope set must be coherent: local execution implies tool use. */
export function assertScopeSet(scopes: readonly string[]): void {
  if (scopes.includes("runtime:local") && !scopes.includes("chat:tools")) oauthError("invalid_scope");
}
/** Refresh ends 90 days after the grant, or after 30 days without a refresh. */
export function grantRefreshExpired(
  grant: { createdAt: number; accessExpiresAt: number; refreshExpiresAt?: number; lastUsedAt?: number },
  now: number,
): boolean {
  const absolute = grant.refreshExpiresAt ?? grant.createdAt + REFRESH_ABSOLUTE_MS;
  const lastUsedAt = grant.lastUsedAt ?? grant.accessExpiresAt - ACCESS_MS;
  return now >= absolute || now - lastUsedAt >= REFRESH_IDLE_MS;
}
/** Account blocks and deletion end every grant-backed path with an OAuth error. */
export async function assertGrantAccountActive(ctx: QueryCtx | MutationCtx, userId: string, error: "invalid_token" | "invalid_grant"): Promise<void> {
  if (!await isAccountActive(ctx.db, userId)) oauthError(error);
}
export function validRedirect(raw: string): boolean {
  try {
    const url = new URL(raw);
    return !url.username && !url.password && !url.hash &&
      (url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)));
  } catch { return false; }
}
export async function pkceChallenge(verifier: string): Promise<string> {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) oauthError("invalid_grant");
  const hex = await sha256Hex(verifier);
  return btoa(String.fromCharCode(...(hex.match(/../g) ?? []).map(byte => parseInt(byte, 16))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function grantedContext<T extends QueryCtx | MutationCtx>(ctx: T, userId: string): T {
  return { ...ctx, auth: { ...ctx.auth, getUserIdentity: async () => ({
    subject: userId, issuer: "nanthai-mcp", tokenIdentifier: `nanthai-mcp|${userId}`,
  }) } };
}
export async function authenticateGrant(ctx: QueryCtx | MutationCtx, accessToken: string, scope?: string) {
  const hash = await sha256Hex(accessToken);
  const grant = await ctx.db.query("externalMcpGrants").withIndex("by_access", q => q.eq("accessHash", hash)).unique();
  if (!grant || grant.revokedAt !== undefined || grant.accessExpiresAt <= Date.now() || grant.resource !== `${process.env.CONVEX_SITE_URL}/mcp`) oauthError("invalid_token");
  if (scope && !grant.accessScopes.includes(scope)) oauthError("insufficient_scope");
  await assertGrantAccountActive(ctx, grant.userId, "invalid_token");
  return grant;
}
