import assert from "node:assert/strict";
import test from "node:test";
import type { ActionCtx } from "../_generated/server";
import { handleDownload } from "../downloads/http";
import {
  DEFAULT_LEGACY_DOWNLOAD_LINKS_UNTIL,
  buildDownloadUrl,
  downloadLinkExpirySeconds,
  legacyDownloadLinksUntil,
  signDownloadToken,
  verifyDownloadToken,
} from "../downloads/links";

const SECRET = "s".repeat(40);
const NOW = Date.UTC(2026, 10, 16, 10, 30);
const env = { CONVEX_SITE_URL: "https://site.example/", DOWNLOAD_LINK_SECRET: SECRET };

function downloadCtx(options: { identity?: boolean; owned?: boolean } = {}) {
  const queries: unknown[] = [];
  const ctx = {
    auth: { getUserIdentity: async () => options.identity ? { subject: "user_1" } : null },
    runQuery: async (_ref: unknown, args: unknown) => { queries.push(args); return options.owned === true; },
    storage: { get: async () => new Blob(["hello"], { type: "text/plain" }) },
  };
  return { ctx: ctx as unknown as ActionCtx, queries };
}

test("signed links verify, expire and reject tampering", async () => {
  const expiry = downloadLinkExpirySeconds(NOW);
  // Bucketed to the hour, so a reactive payload yields a stable URL for an hour.
  assert.equal(expiry, downloadLinkExpirySeconds(NOW + 20 * 60 * 1_000));
  assert.ok(expiry * 1_000 - NOW >= 24 * 60 * 60 * 1_000);
  const token = await signDownloadToken("kg2abc", expiry, SECRET);
  assert.deepEqual(await verifyDownloadToken(token, SECRET, NOW), { ok: true, storageId: "kg2abc" });
  assert.deepEqual(await verifyDownloadToken(token, SECRET, expiry * 1_000), { ok: false, reason: "expired" });
  assert.deepEqual(await verifyDownloadToken(token, "x".repeat(40), NOW), { ok: false, reason: "invalid_signature" });
  const swapped = token.replace("kg2abc", "kg2xyz");
  assert.deepEqual(await verifyDownloadToken(swapped, SECRET, NOW), { ok: false, reason: "invalid_signature" });
  const extended = token.replace(`.${expiry}.`, `.${expiry + 3_600}.`);
  assert.deepEqual(await verifyDownloadToken(extended, SECRET, NOW), { ok: false, reason: "invalid_signature" });
  assert.deepEqual(await verifyDownloadToken("kg2abc", SECRET, NOW), { ok: false, reason: "malformed" });
});

test("issued URLs are signed when the secret is configured and legacy otherwise", async () => {
  const signed = await buildDownloadUrl("kg2abc", "Q3 report.docx", { env, nowMs: NOW });
  assert.match(signed ?? "", /^https:\/\/site\.example\/download\?t=kg2abc\.\d+\.[\w-]{43}&filename=Q3%20report\.docx$/);
  assert.doesNotMatch(signed ?? "", /storageId=/);
  assert.equal(
    await buildDownloadUrl("kg2abc", "a.md", { env: { CONVEX_SITE_URL: "https://site.example", DOWNLOAD_LINK_SECRET: "short" } }),
    "https://site.example/download?storageId=kg2abc&filename=a.md",
  );
  assert.equal(await buildDownloadUrl("kg2abc", "a.md", { env: {} }), null);
});

test("the route serves valid tokens and reports expired or forged ones", async () => {
  const url = await buildDownloadUrl("kg2abc", "a.txt", { env, nowMs: NOW });
  const { ctx } = downloadCtx();
  const ok = await handleDownload(ctx, new Request(url ?? ""), { env, nowMs: NOW });
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "hello");
  const expired = await handleDownload(ctx, new Request(url ?? ""), { env, nowMs: NOW + 3 * 24 * 60 * 60 * 1_000 });
  assert.equal(expired.status, 410);
  const forged = await handleDownload(ctx, new Request(`${url}`.replace(/\.[\w-]{43}&/, `.${"A".repeat(43)}&`)), { env, nowMs: NOW });
  assert.equal(forged.status, 403);
  const unconfigured = await handleDownload(ctx, new Request(url ?? ""), { env: {}, nowMs: NOW });
  assert.equal(unconfigured.status, 503);
});

test("legacy storage-ID links work during the transition and then need an owner session", async () => {
  const legacy = new Request("https://site.example/download?storageId=kg2abc&filename=a.txt");
  assert.equal((await handleDownload(downloadCtx().ctx, legacy, { env, nowMs: NOW })).status, 200);
  const after = DEFAULT_LEGACY_DOWNLOAD_LINKS_UNTIL;
  assert.equal((await handleDownload(downloadCtx().ctx, legacy, { env, nowMs: after })).status, 401);
  const stranger = downloadCtx({ identity: true, owned: false });
  assert.equal((await handleDownload(stranger.ctx, legacy, { env, nowMs: after })).status, 404);
  assert.deepEqual(stranger.queries, [{ storageId: "kg2abc" }]);
  const owner = downloadCtx({ identity: true, owned: true });
  assert.equal((await handleDownload(owner.ctx, legacy, { env, nowMs: after })).status, 200);
  // Operators can end the transition early.
  assert.equal((await handleDownload(downloadCtx().ctx, legacy, { env: { ...env, LEGACY_DOWNLOAD_LINKS_UNTIL: "0" }, nowMs: NOW })).status, 401);
});

test("the transition date accepts epoch milliseconds or ISO dates", () => {
  assert.equal(legacyDownloadLinksUntil({}), DEFAULT_LEGACY_DOWNLOAD_LINKS_UNTIL);
  assert.equal(legacyDownloadLinksUntil({ LEGACY_DOWNLOAD_LINKS_UNTIL: "2026-12-01" }), Date.UTC(2026, 11, 1));
  assert.equal(legacyDownloadLinksUntil({ LEGACY_DOWNLOAD_LINKS_UNTIL: "1700000000000" }), 1_700_000_000_000);
  assert.equal(legacyDownloadLinksUntil({ LEGACY_DOWNLOAD_LINKS_UNTIL: "nonsense" }), DEFAULT_LEGACY_DOWNLOAD_LINKS_UNTIL);
});
