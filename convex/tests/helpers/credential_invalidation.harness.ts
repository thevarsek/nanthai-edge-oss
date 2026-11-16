// Shared in-memory harness for credential invalidation tests.
import assert from "node:assert/strict";

import { getFunctionName } from "convex/server";

import { encryptOAuthCredentials } from "../../lib/secret_crypto";
import {
  deleteConnection as deleteAppleCalendar,
} from "../../oauth/apple_calendar";
import { deleteConnection as deleteCloze } from "../../oauth/cloze";
import {
  deleteConnection as deleteGoogle,
  deleteDriveFileGrantsForUser,
  getConnectionInternal as getGoogle,
} from "../../oauth/google";
import { deleteConnection as deleteGmailManual } from "../../oauth/gmail_manual";
import { deleteConnection as deleteMicrosoft } from "../../oauth/microsoft";
import {
  deleteConnection as deleteNotion,
  getConnectionInternal as getNotion,
} from "../../oauth/notion";
import {
  deleteConnection as deleteSlack,
  getConnectionInternal as getSlack,
} from "../../oauth/slack";
import {
  deleteOAuthConnectionsForProvider,
  inspectUserCredentials,
  invalidateUserOpenRouterKey,
  revokeUserOAuthConnections,
} from "../../security/credential_invalidation";

process.env.CONVEX_SECRET_ENCRYPTION_KEY = "invalidation-test-key";
process.env.CONVEX_SECRET_ENCRYPTION_ACTIVE_KID = "k1";
process.env.CONVEX_SECRET_LEGACY_READ_MODE = "migrate";

export type Row = Record<string, unknown> & { _id: string };
export type Tables = Record<string, Row[]>;

export const SENTINEL_TOKENS = ["sentinel-access", "sentinel-refresh", "sk-or-sentinel-key"];

function buildDb(tables: Tables) {
  let nextId = 1;
  const query = (table: string) => {
    let rows = () => tables[table] ?? [];
    const builder = {
      withIndex: (_name: string, build: (q: unknown) => unknown) => {
        const conditions: Array<[string, unknown]> = [];
        const q = {
          eq: (field: string, value: unknown) => {
            conditions.push([field, value]);
            return q;
          },
        };
        build(q);
        const all = rows();
        rows = () => all.filter((row) => conditions.every(([f, v]) => row[f] === v));
        return builder;
      },
      collect: async () => [...rows()],
      first: async () => rows()[0] ?? null,
      unique: async () => {
        const found = rows();
        if (found.length > 1) throw new Error("unique() matched multiple rows");
        return found[0] ?? null;
      },
    };
    return builder;
  };
  return {
    query,
    delete: async (id: string) => {
      for (const table of Object.keys(tables)) {
        tables[table] = tables[table].filter((row) => row._id !== id);
      }
    },
    insert: async (table: string, value: Record<string, unknown>) => {
      const _id = `new_${nextId++}`;
      (tables[table] ??= []).push({ _id, ...value });
      return _id;
    },
  };
}

type Handlers = Record<string, (ctx: unknown, args: any) => Promise<unknown>>;

export function buildCtx(tables: Tables, options: { failInspectFor?: string } = {}) {
  const db = buildDb(tables);
  const dbCtx = { db, storage: { delete: async () => undefined } };
  const handlers: Handlers = {
    "oauth/google:getConnectionInternal": (c, a) => (getGoogle as any)._handler(c, a),
    "oauth/notion:getConnectionInternal": (c, a) => (getNotion as any)._handler(c, a),
    "oauth/slack:getConnectionInternal": (c, a) => (getSlack as any)._handler(c, a),
    "oauth/google:deleteConnection": (c, a) => (deleteGoogle as any)._handler(c, a),
    "oauth/google:deleteDriveFileGrantsForUser": (c, a) =>
      (deleteDriveFileGrantsForUser as any)._handler(c, a),
    "oauth/notion:deleteConnection": (c, a) => (deleteNotion as any)._handler(c, a),
    "oauth/slack:deleteConnection": (c, a) => (deleteSlack as any)._handler(c, a),
    "oauth/microsoft:deleteConnection": (c, a) => (deleteMicrosoft as any)._handler(c, a),
    "oauth/gmail_manual:deleteConnection": (c, a) => (deleteGmailManual as any)._handler(c, a),
    "oauth/apple_calendar:deleteConnection": (c, a) => (deleteAppleCalendar as any)._handler(c, a),
    "oauth/cloze:deleteConnection": (c, a) => (deleteCloze as any)._handler(c, a),
    "security/credential_invalidation:deleteOAuthConnectionsForProvider": (c, a) =>
      (deleteOAuthConnectionsForProvider as any)._handler(c, a),
    "security/credential_invalidation:invalidateUserOpenRouterKey": (c, a) =>
      (invalidateUserOpenRouterKey as any)._handler(c, a),
    "security/credential_invalidation:inspectUserCredentials": async (c, a) => {
      if (a.userId === options.failInspectFor) throw new Error("boom");
      return (inspectUserCredentials as any)._handler(c, a);
    },
    "security/credential_invalidation:revokeUserOAuthConnections": (c, a) =>
      (revokeUserOAuthConnections as any)._handler(ctx, a),
  };
  const dispatch = (ref: unknown, args: unknown) => {
    const handler = handlers[getFunctionName(ref as never)];
    assert.ok(handler, `unexpected function ${getFunctionName(ref as never)}`);
    return handler(dbCtx, args);
  };
  const ctx = {
    ...dbCtx,
    runQuery: dispatch,
    runMutation: dispatch,
    runAction: dispatch,
  };
  return ctx;
}

async function oauthRow(userId: string, provider: string, encrypt = true): Promise<Row> {
  const base = {
    _id: `oauth_${userId}_${provider}`,
    userId,
    provider,
    expiresAt: 0,
    scopes: [],
    status: "active",
    connectedAt: 1,
  };
  if (!encrypt) {
    return { ...base, accessToken: "enc-placeholder", refreshToken: "" };
  }
  const encrypted = await encryptOAuthCredentials({
    userId,
    provider,
    accessToken: SENTINEL_TOKENS[0],
    refreshToken: SENTINEL_TOKENS[1],
  });
  return {
    ...base,
    accessToken: encrypted.encryptedAccessToken,
    refreshToken: encrypted.encryptedRefreshToken,
  };
}

export const ALL_PROVIDERS = [
  "google",
  "notion",
  "slack",
  "microsoft",
  "gmail_manual",
  "apple_calendar",
  "cloze",
];

export async function seedUser(tables: Tables, userId: string, providers = ALL_PROVIDERS) {
  (tables.userSecrets ??= []).push({ _id: `secret_${userId}`, userId, apiKey: SENTINEL_TOKENS[2] });
  (tables.openRouterExchangeAttempts ??= []).push({ _id: `attempt_${userId}`, userId });
  (tables.googleDriveFileGrants ??= []).push({ _id: `grant_${userId}`, userId });
  for (const provider of providers) {
    const encrypt = ["google", "notion", "slack"].includes(provider);
    (tables.oauthConnections ??= []).push(await oauthRow(userId, provider, encrypt));
  }
}

export function emptyTables(): Tables {
  return {
    userSecrets: [],
    openRouterExchangeAttempts: [],
    oauthConnections: [],
    googleDriveFileGrants: [],
    fileAttachments: [],
  };
}

export async function withFetch<T>(
  responder: (url: string) => Response | Promise<Response>,
  run: (calls: Array<{ url: string; body: string }>) => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  const calls: Array<{ url: string; body: string }> = [];
  process.env.NOTION_CLIENT_ID = "notion_client";
  process.env.NOTION_CLIENT_SECRET = "notion_secret";
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
    return responder(String(url));
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  }
}

export const okResponse = () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) as Response;

export function assertNoSecrets(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const secret of SENTINEL_TOKENS) assert.ok(!serialized.includes(secret), secret);
  assert.ok(!serialized.includes("enc:v"), "ciphertext envelope leaked");
}

export const idsOf = (rows: Row[]) => rows.map((row) => row._id).sort();
