// convex/preferences/store_purchase_verification.ts
// =============================================================================
// Server-side confirmation of App Store and Google Play purchases.
//
// Clients report a purchase identifier; Pro is granted only after Apple's App
// Store Server API or Google's Play Developer API confirms that identifier is
// a paid purchase of the Pro product for this app. Test purchases (sandbox /
// license testers) are accepted only where STORE_ACCEPT_TEST_PURCHASES=true.
// Runs in the default Convex runtime (Web Crypto + fetch), no Node required.
// =============================================================================

import { storeAccountTokenMatches } from "./store_account_token";

export const APP_STORE_PRO_PRODUCT_IDS = ["tech.nanthai.edge.pro.lifetime"];
export const PLAY_PRO_PRODUCT_IDS = ["nanthai.pro.lifetime"];

const APP_STORE_HOSTS = {
  production: "https://api.storekit.itunes.apple.com",
  sandbox: "https://api.storekit-sandbox.itunes.apple.com",
};
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const PLAY_SCOPE = "https://www.googleapis.com/auth/androidpublisher";

type Env = Record<string, string | undefined>;
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type StoreVerification =
  | { ok: true; productId: string; externalPurchaseId: string; environment: string }
  | { ok: false; reason: string; retryable: boolean };

export type AppStoreConfig = { keyId: string; issuerId: string; privateKey: string; bundleId: string; acceptTest: boolean };
export type PlayConfig = { clientEmail: string; privateKey: string; packageName: string; acceptTest: boolean };

const acceptsTest = (env: Env) => env.STORE_ACCEPT_TEST_PURCHASES?.trim() === "true";
const pem = (value: string | undefined) => value?.trim().replace(/\\n/g, "\n");

export function resolveAppStoreConfig(env: Env = process.env): AppStoreConfig | null {
  const keyId = env.APP_STORE_IAP_KEY_ID?.trim();
  const issuerId = env.APP_STORE_IAP_ISSUER_ID?.trim();
  const privateKey = pem(env.APP_STORE_IAP_PRIVATE_KEY);
  const bundleId = env.APP_STORE_BUNDLE_ID?.trim();
  if (!keyId || !issuerId || !privateKey || !bundleId) return null;
  return { keyId, issuerId, privateKey, bundleId, acceptTest: acceptsTest(env) };
}

export function resolvePlayConfig(env: Env = process.env): PlayConfig | null {
  const clientEmail = env.PLAY_CLIENT_EMAIL?.trim();
  const privateKey = pem(env.PLAY_PRIVATE_KEY);
  const packageName = env.PLAY_PACKAGE_NAME?.trim();
  if (!clientEmail || !privateKey || !packageName) return null;
  return { clientEmail, privateKey, packageName, acceptTest: acceptsTest(env) };
}

// -- JWT signing ---------------------------------------------------------------

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const encodeJson = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)));

function pemToDer(pemText: string): ArrayBuffer {
  const body = pemText.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

export async function signJwt(
  algorithm: "ES256" | "RS256",
  header: Record<string, string>,
  payload: Record<string, unknown>,
  privateKeyPem: string,
): Promise<string> {
  const params = algorithm === "ES256"
    ? { importAlg: { name: "ECDSA", namedCurve: "P-256" }, signAlg: { name: "ECDSA", hash: "SHA-256" } }
    : { importAlg: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, signAlg: { name: "RSASSA-PKCS1-v1_5" } };
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(privateKeyPem), params.importAlg, false, ["sign"]);
  const input = `${encodeJson({ ...header, alg: algorithm, typ: "JWT" })}.${encodeJson(payload)}`;
  // Web Crypto ECDSA signatures are already the raw r||s form JWS expects.
  const signature = await crypto.subtle.sign(params.signAlg, key, new TextEncoder().encode(input));
  return `${input}.${base64Url(new Uint8Array(signature))}`;
}

export function decodeJwsPayload(jws: string): Record<string, unknown> {
  const part = jws.split(".")[1] ?? "";
  const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))));
}

const retryableStatus = (status: number) => status === 401 || status === 403 || status === 429 || status >= 500;

// -- App Store -----------------------------------------------------------------

/** Pure decision on a decoded App Store transaction payload. */
export function evaluateAppStoreTransaction(
  transaction: Record<string, unknown>,
  requestedId: string,
  config: Pick<AppStoreConfig, "bundleId" | "acceptTest">,
  expectedAccountToken?: string,
): StoreVerification {
  const reject = (reason: string): StoreVerification => ({ ok: false, reason, retryable: false });
  if (transaction.bundleId !== config.bundleId) return reject("bundle_mismatch");
  if (expectedAccountToken !== undefined && !storeAccountTokenMatches(transaction.appAccountToken, expectedAccountToken)) {
    return reject("account_mismatch");
  }
  const productId = String(transaction.productId ?? "");
  if (!APP_STORE_PRO_PRODUCT_IDS.includes(productId)) return reject("product_not_pro");
  if (String(transaction.originalTransactionId ?? "") !== requestedId) return reject("not_original_transaction");
  if (transaction.revocationDate !== undefined) return reject("revoked");
  const environment = String(transaction.environment ?? "");
  if (environment !== "Production" && !(config.acceptTest && environment === "Sandbox")) return reject("test_purchase");
  return { ok: true, productId, externalPurchaseId: requestedId, environment };
}

export async function verifyAppStorePurchase(
  transactionId: string,
  config: AppStoreConfig,
  fetchImpl: FetchLike = fetch,
  expectedAccountToken?: string,
): Promise<StoreVerification> {
  if (!/^\d{1,32}$/.test(transactionId)) return { ok: false, reason: "malformed_transaction_id", retryable: false };
  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt("ES256", { kid: config.keyId }, {
    iss: config.issuerId, iat: now, exp: now + 300, aud: "appstoreconnect-v1", bid: config.bundleId,
  }, config.privateKey);
  const hosts = config.acceptTest ? [APP_STORE_HOSTS.production, APP_STORE_HOSTS.sandbox] : [APP_STORE_HOSTS.production];
  for (const host of hosts) {
    const response = await fetchImpl(`${host}/inApps/v1/transactions/${transactionId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 404) continue;
    if (!response.ok) return { ok: false, reason: `app_store_http_${response.status}`, retryable: retryableStatus(response.status) };
    const body = (await response.json()) as { signedTransactionInfo?: string };
    if (!body.signedTransactionInfo) return { ok: false, reason: "app_store_missing_transaction", retryable: true };
    return evaluateAppStoreTransaction(
      decodeJwsPayload(body.signedTransactionInfo),
      transactionId,
      config,
      expectedAccountToken,
    );
  }
  return { ok: false, reason: "transaction_not_found", retryable: false };
}

// -- Google Play ---------------------------------------------------------------

/** Pure decision on a Play `purchases.products.get` response. */
export function evaluatePlayPurchase(
  purchase: Record<string, unknown>,
  productId: string,
  purchaseToken: string,
  config: Pick<PlayConfig, "acceptTest">,
  expectedAccountToken?: string,
): StoreVerification {
  const reject = (reason: string): StoreVerification => ({ ok: false, reason, retryable: false });
  if (
    expectedAccountToken !== undefined
    && !storeAccountTokenMatches(purchase.obfuscatedExternalAccountId, expectedAccountToken)
  ) return reject("account_mismatch");
  if (purchase.purchaseState !== 0) return reject(purchase.purchaseState === 2 ? "pending" : "not_purchased");
  // purchaseType is absent for real purchases; 0 = license test, 1 = promo code, 2 = rewarded.
  const type = purchase.purchaseType;
  if (type === 0 && !config.acceptTest) return reject("test_purchase");
  if (type !== undefined && type !== 0 && type !== 1) return reject("unsupported_purchase_type");
  return { ok: true, productId, externalPurchaseId: purchaseToken, environment: type === 0 ? "Sandbox" : "Production" };
}

export async function verifyPlayPurchase(
  purchaseToken: string,
  productId: string,
  config: PlayConfig,
  fetchImpl: FetchLike = fetch,
  expectedAccountToken?: string,
): Promise<StoreVerification> {
  if (!PLAY_PRO_PRODUCT_IDS.includes(productId)) return { ok: false, reason: "product_not_pro", retryable: false };
  if (!purchaseToken || purchaseToken.length > 4096) return { ok: false, reason: "malformed_token", retryable: false };
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt("RS256", {}, {
    iss: config.clientEmail, scope: PLAY_SCOPE, aud: GOOGLE_TOKEN_URL, iat: now, exp: now + 300,
  }, config.privateKey);
  const tokenResponse = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  });
  if (!tokenResponse.ok) return { ok: false, reason: `google_token_http_${tokenResponse.status}`, retryable: true };
  const { access_token: accessToken } = (await tokenResponse.json()) as { access_token?: string };
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(config.packageName)}`
    + `/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
  const response = await fetchImpl(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (response.status === 400 || response.status === 404 || response.status === 410) {
    return { ok: false, reason: "token_not_found", retryable: false };
  }
  if (!response.ok) return { ok: false, reason: `play_http_${response.status}`, retryable: retryableStatus(response.status) };
  return evaluatePlayPurchase(
    (await response.json()) as Record<string, unknown>,
    productId,
    purchaseToken,
    config,
    expectedAccountToken,
  );
}
