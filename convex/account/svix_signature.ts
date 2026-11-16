// convex/account/svix_signature.ts
// Svix webhook signature verification (the scheme Clerk webhooks use), written
// against Web Crypto so no extra dependency is needed.

export const SVIX_TOLERANCE_SECONDS = 5 * 60;

export type SvixVerification =
  | { ok: true }
  | { ok: false; reason: "missing_secret" | "missing_headers" | "stale_timestamp" | "bad_signature" };

function base64ToBytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function svixSignature(secretBytes: Uint8Array, signedContent: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedContent)));
}

export async function verifySvixSignature(args: {
  secret: string | undefined;
  id: string | null;
  timestamp: string | null;
  signatureHeader: string | null;
  body: string;
  nowMs: number;
}): Promise<SvixVerification> {
  // Svix secrets are "<prefix>_<base64>"; standard base64 never contains "_".
  const secretBytes = args.secret ? base64ToBytes(args.secret.slice(args.secret.indexOf("_") + 1)) : null;
  if (!secretBytes?.length) return { ok: false, reason: "missing_secret" };
  if (!args.id || !args.timestamp || !args.signatureHeader) return { ok: false, reason: "missing_headers" };
  if (!/^\d{1,12}$/.test(args.timestamp)) return { ok: false, reason: "stale_timestamp" };
  const timestampSeconds = Number(args.timestamp);
  if (Math.abs(args.nowMs / 1000 - timestampSeconds) > SVIX_TOLERANCE_SECONDS) {
    return { ok: false, reason: "stale_timestamp" };
  }
  const expected = await svixSignature(secretBytes, `${args.id}.${args.timestamp}.${args.body}`);
  // The header may carry several space-separated "v1,<base64>" entries during
  // secret rotation; any matching entry is accepted.
  for (const entry of args.signatureHeader.split(" ")) {
    const [version, encoded] = entry.split(",", 2);
    if (version !== "v1" || !encoded) continue;
    const candidate = base64ToBytes(encoded);
    if (candidate && constantTimeEqual(candidate, expected)) return { ok: true };
  }
  return { ok: false, reason: "bad_signature" };
}
