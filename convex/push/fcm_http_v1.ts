"use node";

import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { buildFcmPayload, type PushMessage } from "./payloads";

const FCM_ACCESS_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_SEND_URL_PREFIX = "https://fcm.googleapis.com/v1/projects";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

type FcmTokenDoc = { _id: Id<"deviceTokens">; token: string };

type FcmHttpV1Config = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

export function resolveFcmHttpV1Config(
  env: NodeJS.ProcessEnv = process.env,
): FcmHttpV1Config | null {
  const projectId = env.FCM_PROJECT_ID?.trim();
  const clientEmail = env.FCM_CLIENT_EMAIL?.trim();
  const privateKey = env.FCM_PRIVATE_KEY?.trim();

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return { projectId, clientEmail, privateKey };
}

export async function sendFcmNotifications(
  ctx: ActionCtx,
  args: {
    tokens: FcmTokenDoc[];
    title: string;
    body: string;
    chatId?: string;
    category?: string;
  },
): Promise<void> {
  const config = resolveFcmHttpV1Config();
  if (!config) {
    console.error(
      "[push] Missing FCM HTTP v1 env vars (FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY); skipping FCM delivery",
    );
    return;
  }

  const accessToken = await fetchFcmAccessToken(config);
  const message: PushMessage = {
    title: args.title,
    body: args.body,
    chatId: args.chatId,
    category: args.category,
  };

  for (const tokenDoc of args.tokens) {
    try {
      const response = await fetch(
        `${FCM_SEND_URL_PREFIX}/${config.projectId}/messages:send`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json; charset=UTF-8",
          },
          body: JSON.stringify(buildFcmPayload(tokenDoc.token, message)),
        },
      );

      const rawText = await response.text();
      if (response.ok) {
        console.log(`[push] FCM sent to ${tokenDoc.token.slice(0, 8)}...`);
        continue;
      }

      const body = parseFcmResponseBody(rawText);
      const errorCode = extractFcmV1ErrorCode(body);
      const errorMessage = extractFcmV1ErrorMessage(body) ?? rawText;

      if (errorCode === "UNREGISTERED") {
        console.log(
          `[push] FCM token ${tokenDoc.token.slice(0, 8)}... is stale (${errorCode}), deleting`,
        );
        await ctx.runMutation(internal.push.mutations_internal.deleteStaleToken, {
          tokenId: tokenDoc._id,
        });
        continue;
      }

      console.error(
        `[push] FCM ${response.status} for ${tokenDoc.token.slice(0, 8)}... (${errorCode ?? "unknown"}): ${errorMessage}`,
      );
    } catch (error) {
      console.error(`[push] FCM failed for ${tokenDoc.token.slice(0, 8)}...:`, error);
    }
  }
}

export async function fetchFcmAccessToken(
  config: FcmHttpV1Config,
): Promise<string> {
  const assertion = await signGoogleServiceAccountJwt(config);
  const response = await fetch(FCM_ACCESS_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`[push] FCM access token ${response.status}: ${rawText}`);
  }

  const body = parseFcmResponseBody(rawText);
  if (!isPlainObject(body) || typeof body.access_token !== "string") {
    throw new Error(`[push] FCM access token response missing access_token: ${rawText}`);
  }

  return body.access_token;
}

export function parseFcmResponseBody(rawText: string): unknown | null {
  try {
    return JSON.parse(rawText);
  } catch {
    return null;
  }
}

export function extractFcmV1ErrorCode(body: unknown): string | null {
  if (!isPlainObject(body) || !isPlainObject(body.error)) {
    return null;
  }

  const details = body.error.details;
  if (!Array.isArray(details)) {
    return null;
  }

  for (const detail of details) {
    if (isPlainObject(detail) && typeof detail.errorCode === "string") {
      return detail.errorCode;
    }
  }

  return null;
}

export function extractFcmV1ErrorMessage(body: unknown): string | null {
  if (!isPlainObject(body) || !isPlainObject(body.error)) {
    return null;
  }

  return typeof body.error.message === "string" ? body.error.message : null;
}

async function signGoogleServiceAccountJwt(
  config: FcmHttpV1Config,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: config.clientEmail,
    sub: config.clientEmail,
    aud: FCM_ACCESS_TOKEN_URL,
    scope: FCM_SCOPE,
    iat: now,
    exp: now + 3600,
  };

  const signingInput =
    `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;
  const key = await importGooglePrivateKey(config.privateKey);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64UrlEncodeBuffer(new Uint8Array(signature))}`;
}

async function importGooglePrivateKey(privateKeyPem: string): Promise<CryptoKey> {
  const pemBody = privateKeyPem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");

  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function base64UrlEncode(value: string): string {
  return btoa(value)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlEncodeBuffer(buffer: Uint8Array): string {
  let binary = "";
  for (const byte of buffer) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
