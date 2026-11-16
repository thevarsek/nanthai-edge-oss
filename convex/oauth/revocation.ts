// convex/oauth/revocation.ts
// =============================================================================
// Provider-side token revocation shared by the user-facing disconnect actions
// and the admin credential-invalidation action. Every helper is best effort: it
// never throws and never returns or logs token values. `error` is always a short
// machine-readable code.
// =============================================================================

import { decryptOAuthCredentials } from "../lib/secret_crypto";
import {
  getNotionOAuthClientConfig,
  NOTION_OAUTH_REVOKE_URL,
  notionOAuthHeaders,
} from "./notion_oauth";

export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const SLACK_REVOKE_URL = "https://slack.com/api/auth.revoke";

export type RevocationOutcome = { revoked: boolean; error?: string };

export type StoredOAuthTokens = { accessToken: string; refreshToken: string };

export type NotionRevocationRequest = {
  headers: Record<string, string>;
  token: string;
};

async function decryptTokens(
  userId: string,
  provider: string,
  connection: StoredOAuthTokens,
) {
  return decryptOAuthCredentials({
    userId,
    provider,
    accessToken: connection.accessToken,
    refreshToken: connection.refreshToken,
  });
}

function httpOutcome(response: Response): RevocationOutcome {
  return response.ok
    ? { revoked: true }
    : { revoked: false, error: `http_${response.status}` };
}

export async function revokeGoogleConnection(
  userId: string,
  connection: StoredOAuthTokens,
): Promise<RevocationOutcome> {
  let token: string;
  try {
    const credentials = await decryptTokens(userId, "google", connection);
    token = credentials.refreshToken || credentials.accessToken;
  } catch {
    return { revoked: false, error: "decrypt_failed" };
  }
  try {
    const response = await fetch(GOOGLE_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
    return httpOutcome(response);
  } catch {
    return { revoked: false, error: "request_failed" };
  }
}

export async function revokeSlackConnection(
  userId: string,
  connection: StoredOAuthTokens,
): Promise<RevocationOutcome> {
  let accessToken: string;
  try {
    accessToken = (await decryptTokens(userId, "slack", connection)).accessToken;
  } catch {
    return { revoked: false, error: "decrypt_failed" };
  }
  try {
    const response = await fetch(SLACK_REVOKE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    const outcome = httpOutcome(response);
    if (!outcome.revoked) return outcome;
    // Slack answers HTTP 200 with `{ ok: false, error }` for rejected revocations.
    try {
      const body = (await response.json()) as { ok?: boolean; error?: unknown };
      if (body?.ok === false) {
        const code = typeof body.error === "string" ? body.error.slice(0, 64) : "rejected";
        return { revoked: false, error: `slack_${code}` };
      }
    } catch {
      // Unreadable body: fall back to the HTTP status.
    }
    return outcome;
  } catch {
    return { revoked: false, error: "request_failed" };
  }
}

/** Decrypt the Notion token and build the revoke request, or explain why not. */
export async function prepareNotionRevocation(
  userId: string,
  connection: StoredOAuthTokens,
): Promise<{ request: NotionRevocationRequest } | { error: string }> {
  try {
    const credentials = await decryptTokens(userId, "notion", connection);
    return {
      request: {
        headers: notionOAuthHeaders(getNotionOAuthClientConfig()),
        token: credentials.accessToken,
      },
    };
  } catch {
    return { error: "revocation_unavailable" };
  }
}

export async function sendNotionRevocation(
  request: NotionRevocationRequest,
): Promise<RevocationOutcome> {
  try {
    const response = await fetch(NOTION_OAUTH_REVOKE_URL, {
      method: "POST",
      redirect: "manual",
      headers: request.headers,
      body: JSON.stringify({ token: request.token }),
    });
    return httpOutcome(response);
  } catch {
    return { revoked: false, error: "request_failed" };
  }
}

export async function revokeNotionConnection(
  userId: string,
  connection: StoredOAuthTokens,
): Promise<RevocationOutcome> {
  const prepared = await prepareNotionRevocation(userId, connection);
  if ("error" in prepared) return { revoked: false, error: prepared.error };
  return sendNotionRevocation(prepared.request);
}
