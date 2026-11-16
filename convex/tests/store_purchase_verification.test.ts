import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeJwsPayload,
  evaluateAppStoreTransaction,
  evaluatePlayPurchase,
  resolveAppStoreConfig,
  resolvePlayConfig,
  signJwt,
  verifyAppStorePurchase,
  verifyPlayPurchase,
  type AppStoreConfig,
  type PlayConfig,
} from "../preferences/store_purchase_verification";
import { verifyAppStoreEntitlement, verifyPlayEntitlement } from "../preferences/store_purchase_actions";

async function pkcs8Pem(algorithm: EcKeyGenParams | RsaHashedKeyGenParams) {
  const pair = (await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"])) as CryptoKeyPair;
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const body = Buffer.from(der).toString("base64").replace(/(.{64})/g, "$1\n");
  return { pem: `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`, publicKey: pair.publicKey };
}

const ecKey = pkcs8Pem({ name: "ECDSA", namedCurve: "P-256" });
const rsaKey = pkcs8Pem({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" });

const jws = (payload: Record<string, unknown>) =>
  `e30.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const paidTransaction = {
  bundleId: "tech.example.app",
  productId: "tech.nanthai.edge.pro.lifetime",
  originalTransactionId: "2000000123",
  environment: "Production",
};

async function appleConfig(acceptTest = false): Promise<AppStoreConfig> {
  return { keyId: "KEY123", issuerId: "issuer", privateKey: (await ecKey).pem, bundleId: "tech.example.app", acceptTest };
}
async function playConfig(acceptTest = false): Promise<PlayConfig> {
  return { clientEmail: "svc@example.iam.gserviceaccount.com", privateKey: (await rsaKey).pem, packageName: "com.example.app", acceptTest };
}

test("signJwt produces ES256 and RS256 signatures that verify with the matching public key", async () => {
  for (const [algorithm, key, verifyAlg] of [
    ["ES256", await ecKey, { name: "ECDSA", hash: "SHA-256" }],
    ["RS256", await rsaKey, { name: "RSASSA-PKCS1-v1_5" }],
  ] as const) {
    const token = await signJwt(algorithm, { kid: "k" }, { iss: "me" }, key.pem);
    const [header, payload, signature] = token.split(".");
    assert.deepEqual(decodeJwsPayload(token), { iss: "me" });
    assert.equal(JSON.parse(Buffer.from(header, "base64url").toString()).alg, algorithm);
    const valid = await crypto.subtle.verify(verifyAlg, key.publicKey, Buffer.from(signature, "base64url"), new TextEncoder().encode(`${header}.${payload}`));
    assert.equal(valid, true);
  }
});

test("App Store evaluation accepts only paid Pro purchases for this bundle", () => {
  const config = { bundleId: "tech.example.app", acceptTest: false };
  assert.equal(evaluateAppStoreTransaction(paidTransaction, "2000000123", config).ok, true);
  const reason = (overrides: Record<string, unknown>, cfg = config) => {
    const result = evaluateAppStoreTransaction({ ...paidTransaction, ...overrides }, "2000000123", cfg);
    return result.ok ? "ok" : result.reason;
  };
  assert.equal(reason({ bundleId: "other.app" }), "bundle_mismatch");
  assert.equal(reason({ productId: "tech.nanthai.edge.tip" }), "product_not_pro");
  assert.equal(reason({ originalTransactionId: "999" }), "not_original_transaction");
  assert.equal(reason({ revocationDate: 1 }), "revoked");
  assert.equal(reason({ environment: "Sandbox" }), "test_purchase");
  assert.equal(reason({ environment: "Sandbox" }, { ...config, acceptTest: true }), "ok");
});

test("App Store verification uses production only unless test purchases are accepted", async () => {
  const calls: string[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push(url);
    assert.match(String((init?.headers as Record<string, string>).authorization), /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    return url.includes("sandbox")
      ? json(200, { signedTransactionInfo: jws({ ...paidTransaction, environment: "Sandbox" }) })
      : new Response("", { status: 404 });
  };
  const strict = await verifyAppStorePurchase("2000000123", await appleConfig(false), fetchImpl);
  assert.deepEqual(strict, { ok: false, reason: "transaction_not_found", retryable: false });
  assert.equal(calls.length, 1);

  const lenient = await verifyAppStorePurchase("2000000123", await appleConfig(true), fetchImpl);
  assert.deepEqual(lenient, { ok: true, productId: paidTransaction.productId, externalPurchaseId: "2000000123", environment: "Sandbox" });
  assert.equal(calls.length, 3);

  const forged = await verifyAppStorePurchase("forged_appstore_txn_1", await appleConfig(true), fetchImpl);
  assert.deepEqual(forged, { ok: false, reason: "malformed_transaction_id", retryable: false });
  assert.equal(calls.length, 3);

  const unavailable = await verifyAppStorePurchase("2000000123", await appleConfig(), async () => new Response("", { status: 503 }));
  assert.deepEqual(unavailable, { ok: false, reason: "app_store_http_503", retryable: true });
});

test("Play evaluation rejects pending, cancelled, test and rewarded purchases", () => {
  const reason = (purchase: Record<string, unknown>, acceptTest = false) => {
    const result = evaluatePlayPurchase(purchase, "nanthai.pro.lifetime", "tok", { acceptTest });
    return result.ok ? `ok:${result.environment}` : result.reason;
  };
  assert.equal(reason({ purchaseState: 0 }), "ok:Production");
  assert.equal(reason({ purchaseState: 0, purchaseType: 1 }), "ok:Production");
  assert.equal(reason({ purchaseState: 2 }), "pending");
  assert.equal(reason({ purchaseState: 1 }), "not_purchased");
  assert.equal(reason({ purchaseState: 0, purchaseType: 0 }), "test_purchase");
  assert.equal(reason({ purchaseState: 0, purchaseType: 0 }, true), "ok:Sandbox");
  assert.equal(reason({ purchaseState: 0, purchaseType: 2 }), "unsupported_purchase_type");
});

test("Play verification exchanges a service-account token and queries the server's package", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.startsWith("https://oauth2.googleapis.com/token")) return json(200, { access_token: "access" });
    return json(200, { purchaseState: 0 });
  };
  const result = await verifyPlayPurchase("tok/en", "nanthai.pro.lifetime", await playConfig(), fetchImpl);
  assert.deepEqual(result, { ok: true, productId: "nanthai.pro.lifetime", externalPurchaseId: "tok/en", environment: "Production" });
  assert.match(String(calls[0]?.init?.body), /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=/);
  assert.equal(calls[1]?.url, "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.example.app/purchases/products/nanthai.pro.lifetime/tokens/tok%2Fen");
  assert.equal((calls[1]?.init?.headers as Record<string, string>).authorization, "Bearer access");

  assert.deepEqual(await verifyPlayPurchase("tok", "nanthai.pro.monthly", await playConfig(), fetchImpl), { ok: false, reason: "product_not_pro", retryable: false });
  const notFound = async (url: string) => url.includes("oauth2") ? json(200, { access_token: "a" }) : json(400, {});
  assert.deepEqual(await verifyPlayPurchase("tok", "nanthai.pro.lifetime", await playConfig(), notFound), { ok: false, reason: "token_not_found", retryable: false });
  const denied = async (url: string) => url.includes("oauth2") ? json(200, { access_token: "a" }) : json(401, {});
  assert.deepEqual(await verifyPlayPurchase("tok", "nanthai.pro.lifetime", await playConfig(), denied), { ok: false, reason: "play_http_401", retryable: true });
});

test("store configs require every variable and accept test purchases only when enabled", () => {
  const apple = { APP_STORE_IAP_KEY_ID: "K", APP_STORE_IAP_ISSUER_ID: "I", APP_STORE_IAP_PRIVATE_KEY: "a\\nb", APP_STORE_BUNDLE_ID: "B" };
  assert.deepEqual(resolveAppStoreConfig(apple), { keyId: "K", issuerId: "I", privateKey: "a\nb", bundleId: "B", acceptTest: false });
  assert.equal(resolveAppStoreConfig({ ...apple, APP_STORE_BUNDLE_ID: " " }), null);
  const play = { PLAY_CLIENT_EMAIL: "e", PLAY_PRIVATE_KEY: "p", PLAY_PACKAGE_NAME: "n", STORE_ACCEPT_TEST_PURCHASES: "true" };
  assert.equal(resolvePlayConfig(play)?.acceptTest, true);
  assert.equal(resolvePlayConfig({ ...play, PLAY_PACKAGE_NAME: undefined }), null);
});

test("verification actions write nothing when store credentials are missing", async () => {
  const saved = { ...process.env };
  for (const key of Object.keys(process.env)) if (/^(APP_STORE_|PLAY_)/.test(key)) delete process.env[key];
  const originalError = console.error;
  console.error = () => {};
  try {
    const ctx = { runMutation: async () => assert.fail("must not grant without verification") } as any;
    assert.equal(await (verifyAppStoreEntitlement as any)._handler(ctx, { userId: "u", transactionId: "1" }), null);
    assert.equal(await (verifyPlayEntitlement as any)._handler(ctx, { userId: "u", purchaseToken: "t", productId: "nanthai.pro.lifetime" }), null);
  } finally {
    console.error = originalError;
    process.env = saved;
  }
});
