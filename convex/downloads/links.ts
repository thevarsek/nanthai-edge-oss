// Signed, expiring links for GET /download.
//
// A link carries `t=<storageId>.<expiresAtSeconds>.<signature>` where the
// signature is HMAC-SHA256 over storage ID and expiry with the deployment
// secret DOWNLOAD_LINK_SECRET. Reactive queries do not re-run when time
// passes, so expiry is bucketed to the hour and lasts at least 24 hours from
// the last time the issuing payload was computed.

type Env = Record<string, string | undefined>;

export const DOWNLOAD_LINK_LIFETIME_SECONDS = 24 * 60 * 60;
const BUCKET_SECONDS = 60 * 60;

/**
 * Old app builds construct `/download?storageId=` themselves. Until this
 * transition ends (override with LEGACY_DOWNLOAD_LINKS_UNTIL as epoch ms or an
 * ISO date; "0" ends it now), that form still works without a session. After
 * it, the form requires a Clerk bearer token for a user who owns the file.
 */
export const DEFAULT_LEGACY_DOWNLOAD_LINKS_UNTIL = Date.UTC(2027, 1, 1);

export function downloadLinkSecret(env: Env = process.env): string | null {
  const secret = env.DOWNLOAD_LINK_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

export function legacyDownloadLinksUntil(env: Env = process.env): number {
  const raw = env.LEGACY_DOWNLOAD_LINKS_UNTIL?.trim();
  if (!raw) return DEFAULT_LEGACY_DOWNLOAD_LINKS_UNTIL;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_LEGACY_DOWNLOAD_LINKS_UNTIL;
}

export function downloadLinkExpirySeconds(nowMs: number): number {
  const bucket = Math.floor(nowMs / 1000 / BUCKET_SECONDS) * BUCKET_SECONDS;
  return bucket + BUCKET_SECONDS + DOWNLOAD_LINK_LIFETIME_SECONDS;
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  return btoa(String.fromCharCode(...signature)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function signDownloadToken(storageId: string, expiresAtSeconds: number, secret: string): Promise<string> {
  return `${storageId}.${expiresAtSeconds}.${await hmac(secret, `${storageId}\n${expiresAtSeconds}`)}`;
}

export type DownloadTokenCheck =
  | { ok: true; storageId: string }
  | { ok: false; reason: "malformed" | "expired" | "invalid_signature" };

export async function verifyDownloadToken(token: string, secret: string, nowMs: number): Promise<DownloadTokenCheck> {
  const match = /^([A-Za-z0-9_-]{1,128})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return { ok: false, reason: "malformed" };
  const [, storageId, expiry] = match;
  const expected = await signDownloadToken(storageId, Number(expiry), secret);
  if (!timingSafeEqual(expected, token)) return { ok: false, reason: "invalid_signature" };
  if (Number(expiry) * 1000 <= nowMs) return { ok: false, reason: "expired" };
  return { ok: true, storageId };
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

/**
 * Download URL for a stored file. Signed when DOWNLOAD_LINK_SECRET is set;
 * otherwise the legacy storage-ID form, so downloads keep working until the
 * deployment secret is configured.
 */
export async function buildDownloadUrl(
  storageId: string,
  filename: string,
  options: { env?: Env; nowMs?: number } = {},
): Promise<string | null> {
  const env = options.env ?? process.env;
  const siteUrl = env.CONVEX_SITE_URL?.trim().replace(/\/$/, "");
  if (!siteUrl) return null;
  const encodedName = encodeURIComponent(filename);
  const secret = downloadLinkSecret(env);
  if (!secret) return `${siteUrl}/download?storageId=${encodeURIComponent(storageId)}&filename=${encodedName}`;
  const token = await signDownloadToken(storageId, downloadLinkExpirySeconds(options.nowMs ?? Date.now()), secret);
  return `${siteUrl}/download?t=${encodeURIComponent(token)}&filename=${encodedName}`;
}
