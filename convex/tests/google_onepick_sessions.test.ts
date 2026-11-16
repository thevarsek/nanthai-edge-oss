import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import { getFunctionName } from "convex/server";

import {
  exchangeGoogleOnePickCode,
  redeemGoogleOnePickRelayHandle,
  startGoogleOnePick,
} from "../oauth/google_onepick";
import {
  claimRelayHandle,
  consumeSession,
  createSession,
  isWellFormedOnePickHandle,
  ONEPICK_SESSION_TTL_MS,
  onePickPkceRequired,
  sha256Base64Url,
} from "../oauth/google_onepick_sessions";

process.env.CONVEX_SECRET_ENCRYPTION_KEY = "oauth-test-key";
process.env.CONVEX_SECRET_ENCRYPTION_ACTIVE_KID = "k1";
process.env.CONVEX_SECRET_LEGACY_READ_MODE = "migrate";

const RELAY = "https://nanthai.tech/mobile-drive-picker";

type Row = Record<string, unknown> & { _id: string };

/** Minimal in-memory `googleOnePickSessions` table for the internal mutations. */
function fakeDb() {
  const rows: Row[] = [];
  let nextId = 1;
  const db = {
    rows,
    query: () => ({
      withIndex: (_index: string, build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown) => {
        const filters: Array<[string, unknown]> = [];
        const q = { eq: (field: string, value: unknown) => { filters.push([field, value]); return q; } };
        build(q);
        const matches = () => rows.filter((row) => filters.every(([field, value]) => row[field] === value));
        return {
          unique: async () => matches()[0] ?? null,
          take: async (limit: number) => matches().slice(0, limit),
        };
      },
    }),
    insert: async (_table: string, value: Record<string, unknown>) => {
      const row = { ...value, _id: `session_${nextId++}` };
      rows.push(row);
      return row._id;
    },
    patch: async (id: string, patch: Record<string, unknown>) => {
      const row = rows.find((candidate) => candidate._id === id);
      if (row) Object.assign(row, patch);
    },
    delete: async (id: string) => {
      const index = rows.findIndex((candidate) => candidate._id === id);
      if (index >= 0) rows.splice(index, 1);
    },
  };
  return db;
}

function googleConnection(userId: string) {
  return {
    _id: `google_${userId}`,
    userId,
    provider: "google",
    accessToken: `picker_token_${userId}`,
    refreshToken: "refresh",
    expiresAt: Date.now() + 60 * 60 * 1000,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
    clientType: "web",
    status: "active",
    connectedAt: 1,
  };
}

function actionCtx(db: ReturnType<typeof fakeDb>, userId: string | null, upserts: Record<string, unknown>[] = []) {
  const handlers: Record<string, (args: any) => Promise<unknown>> = {
    "oauth/google_onepick_sessions:createSession": (args) => (createSession as any)._handler({ db }, args),
    "oauth/google_onepick_sessions:claimRelayHandle": (args) => (claimRelayHandle as any)._handler({ db }, args),
    "oauth/google_onepick_sessions:consumeSession": (args) => (consumeSession as any)._handler({ db }, args),
  };
  return {
    auth: { getUserIdentity: async () => (userId ? { subject: userId } : null) },
    runQuery: async (fn: unknown, args: { userId?: string }) => {
      if (getFunctionName(fn as never) === "account/deletion_state:getAccountAccessState") return false;
      return args.userId ? googleConnection(args.userId) : null;
    },
    runMutation: async (fn: unknown, args: Record<string, unknown>) => {
      const handler = handlers[getFunctionName(fn as never)];
      if (handler) return await handler(args);
      upserts.push(args);
      return null;
    },
  };
}

function tokenFetch(requests: URLSearchParams[]) {
  return (async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes("/token")) {
      requests.push(new URLSearchParams(String(init?.body ?? "")));
      return { ok: true, json: async () => ({ access_token: "access_new", expires_in: 3600 }) } as Response;
    }
    return { ok: true, json: async () => ({ email: "user@example.com" }) } as Response;
  }) as typeof fetch;
}

function isConvexCode(code: string) {
  return (error: unknown) => error instanceof ConvexError && (error as ConvexError<any>).data?.code === code;
}

async function withGoogleEnv<T>(run: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  process.env.GOOGLE_WEB_CLIENT_ID = "web_client";
  process.env.GOOGLE_WEB_CLIENT_SECRET = "web_secret";
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  }
}

test("startGoogleOnePick stores only hashes and an encrypted verifier, and returns an S256 challenge", async () => {
  const db = fakeDb();
  const started = await (startGoogleOnePick as any)._handler(actionCtx(db, "user_1"), { redirectUri: RELAY });

  assert.ok(isWellFormedOnePickHandle(started.relayHandle));
  assert.equal(started.codeChallengeMethod, "S256");
  assert.match(started.codeChallenge, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(db.rows.length, 1);
  const row = db.rows[0]!;
  assert.equal(row.userId, "user_1");
  assert.equal(row.handleHash, await sha256Base64Url(started.relayHandle));
  assert.notEqual(row.handleHash, started.relayHandle);
  assert.match(String(row.encryptedPkceVerifier), /^enc:v2:k1:/);
  assert.equal(row.secretKeyId, "k1");
  assert.equal(row.redirectUri, RELAY);
  assert.ok(Number(row.expiresAt) - Date.now() <= ONEPICK_SESSION_TTL_MS);

  await assert.rejects(
    (startGoogleOnePick as any)._handler(actionCtx(db, "user_1"), { redirectUri: "nanthai-edge://drive-picker" }),
    isConvexCode("VALIDATION"),
  );
});

test("relay handle redeems the owner's picker token once and rejects reuse, garbage and expiry", async () => {
  const db = fakeDb();
  const { relayHandle } = await (startGoogleOnePick as any)._handler(actionCtx(db, "user_1"), { redirectUri: RELAY });

  const signedOut = actionCtx(db, null);
  const redeemed = await (redeemGoogleOnePickRelayHandle as any)._handler(signedOut, { relayHandle });
  assert.equal(redeemed.accessToken, "picker_token_user_1");

  await assert.rejects(
    (redeemGoogleOnePickRelayHandle as any)._handler(signedOut, { relayHandle }),
    isConvexCode("ONEPICK_SESSION_INVALID"),
  );
  await assert.rejects(
    (redeemGoogleOnePickRelayHandle as any)._handler(signedOut, { relayHandle: "short" }),
    isConvexCode("ONEPICK_SESSION_INVALID"),
  );

  const second = await (startGoogleOnePick as any)._handler(actionCtx(db, "user_1"), { redirectUri: RELAY });
  for (const candidate of db.rows) candidate.expiresAt = Date.now() - 1;
  await assert.rejects(
    (redeemGoogleOnePickRelayHandle as any)._handler(signedOut, { relayHandle: second.relayHandle }),
    isConvexCode("ONEPICK_SESSION_INVALID"),
  );
});

test("code exchange with a relay handle sends the stored PKCE verifier and consumes the session", () => withGoogleEnv(async () => {
  const requests: URLSearchParams[] = [];
  globalThis.fetch = tokenFetch(requests);
  const db = fakeDb();
  const upserts: Record<string, unknown>[] = [];
  const ctx = actionCtx(db, "user_1", upserts);
  const started = await (startGoogleOnePick as any)._handler(ctx, { redirectUri: RELAY });

  const result = await (exchangeGoogleOnePickCode as any)._handler(ctx, {
    code: "code_1",
    redirectUri: RELAY,
    relayHandle: started.relayHandle,
  });

  assert.deepEqual(result, { success: true, email: "user@example.com" });
  const verifier = requests[0]?.get("code_verifier");
  assert.ok(verifier);
  assert.equal(await sha256Base64Url(verifier), started.codeChallenge);
  assert.equal(requests[0]?.get("client_secret"), "web_secret");
  assert.equal(upserts[0]?.userId, "user_1");
  assert.ok(db.rows[0]?.consumedAt);

  await assert.rejects(
    (exchangeGoogleOnePickCode as any)._handler(ctx, { code: "code_1", redirectUri: RELAY, relayHandle: started.relayHandle }),
    isConvexCode("ONEPICK_SESSION_INVALID"),
  );
  await assert.rejects(
    (redeemGoogleOnePickRelayHandle as any)._handler(actionCtx(db, null), { relayHandle: started.relayHandle }),
    isConvexCode("ONEPICK_SESSION_INVALID"),
  );
  assert.equal(requests.length, 1);
}));

test("another account cannot redeem a stolen code with the victim's relay handle", () => withGoogleEnv(async () => {
  const requests: URLSearchParams[] = [];
  globalThis.fetch = tokenFetch(requests);
  const db = fakeDb();
  const started = await (startGoogleOnePick as any)._handler(actionCtx(db, "victim"), { redirectUri: RELAY });

  await assert.rejects(
    (exchangeGoogleOnePickCode as any)._handler(actionCtx(db, "attacker"), {
      code: "stolen_code",
      redirectUri: RELAY,
      relayHandle: started.relayHandle,
    }),
    isConvexCode("ONEPICK_SESSION_INVALID"),
  );
  assert.equal(requests.length, 0);
  assert.equal(db.rows[0]?.consumedAt, undefined);

  await assert.rejects(
    (exchangeGoogleOnePickCode as any)._handler(actionCtx(db, "victim"), {
      code: "code_1",
      redirectUri: "https://elsewhere.example/relay",
      relayHandle: started.relayHandle,
    }),
    isConvexCode("ONEPICK_SESSION_INVALID"),
  );
  assert.equal(requests.length, 0);
}));

test("expired sessions cannot be exchanged and are pruned when the user starts again", () => withGoogleEnv(async () => {
  const requests: URLSearchParams[] = [];
  globalThis.fetch = tokenFetch(requests);
  const db = fakeDb();
  const ctx = actionCtx(db, "user_1");
  const stale = await (startGoogleOnePick as any)._handler(ctx, { redirectUri: RELAY });
  db.rows[0]!.expiresAt = Date.now() - 1;

  await assert.rejects(
    (exchangeGoogleOnePickCode as any)._handler(ctx, { code: "code_1", redirectUri: RELAY, relayHandle: stale.relayHandle }),
    isConvexCode("ONEPICK_SESSION_INVALID"),
  );
  assert.equal(requests.length, 0);

  await (startGoogleOnePick as any)._handler(ctx, { redirectUri: RELAY });
  assert.equal(db.rows.length, 1);
  assert.notEqual(db.rows[0]?.handleHash, await sha256Base64Url(stale.relayHandle));
}));

test("legacy exchanges without a relay handle work until OAUTH_ONEPICK_REQUIRE_PKCE=true", () => withGoogleEnv(async () => {
  const requests: URLSearchParams[] = [];
  globalThis.fetch = tokenFetch(requests);
  const db = fakeDb();
  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    delete process.env.OAUTH_ONEPICK_REQUIRE_PKCE;
    await (exchangeGoogleOnePickCode as any)._handler(actionCtx(db, "user_1"), { code: "legacy", redirectUri: RELAY });
    assert.equal(requests[0]?.get("code_verifier"), null);

    process.env.OAUTH_ONEPICK_REQUIRE_PKCE = "true";
    await assert.rejects(
      (exchangeGoogleOnePickCode as any)._handler(actionCtx(db, "user_1"), { code: "legacy", redirectUri: RELAY }),
      isConvexCode("ONEPICK_UPGRADE_REQUIRED"),
    );
    assert.equal(requests.length, 1);
  } finally {
    console.warn = originalWarn;
  }
}));

test("onePickPkceRequired only enables on an explicit true", () => {
  assert.equal(onePickPkceRequired({}), false);
  assert.equal(onePickPkceRequired({ OAUTH_ONEPICK_REQUIRE_PKCE: "false" }), false);
  assert.equal(onePickPkceRequired({ OAUTH_ONEPICK_REQUIRE_PKCE: "1" }), false);
  assert.equal(onePickPkceRequired({ OAUTH_ONEPICK_REQUIRE_PKCE: " TRUE " }), true);
});
