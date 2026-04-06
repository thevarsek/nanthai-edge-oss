export async function signAPNsJWT(
  keyId: string,
  teamId: string,
  privateKeyPEM: string,
): Promise<string> {
  const header = { alg: "ES256", kid: keyId };
  const headerB64 = base64UrlEncode(JSON.stringify(header));

  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: teamId, iat: now };
  const claimsB64 = base64UrlEncode(JSON.stringify(claims));

  const signingInput = `${headerB64}.${claimsB64}`;

  const key = await importP8Key(privateKeyPEM);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    key,
    new TextEncoder().encode(signingInput),
  );

  const signatureB64 = base64UrlEncodeBuffer(derToRaw(new Uint8Array(signature)));
  return `${signingInput}.${signatureB64}`;
}

async function importP8Key(pem: string): Promise<CryptoKey> {
  const pemBody = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");

  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  return await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

function derToRaw(der: Uint8Array): Uint8Array {
  if (der.length === 64) return der;
  if (der[0] !== 0x30) return der;

  let offset = 2;

  if (der[offset] !== 0x02) return der;
  offset++;
  const rLen = der[offset];
  offset++;
  let r = der.slice(offset, offset + rLen);
  offset += rLen;

  if (der[offset] !== 0x02) return der;
  offset++;
  const sLen = der[offset];
  offset++;
  let s = der.slice(offset, offset + sLen);

  if (r.length > 32) r = r.slice(r.length - 32);
  if (s.length > 32) s = s.slice(s.length - 32);

  const raw = new Uint8Array(64);
  raw.set(r, 32 - r.length);
  raw.set(s, 64 - s.length);
  return raw;
}

function base64UrlEncode(str: string): string {
  return btoa(str)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlEncodeBuffer(buf: Uint8Array): string {
  let binary = "";
  for (const byte of buf) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
