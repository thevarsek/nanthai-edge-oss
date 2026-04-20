// convex/tools/cloze/client.ts
// =============================================================================
// Shared Cloze API client helpers.
//
// Cloze's auth header is identical for API keys and OAuth2 access tokens
// (`Authorization: Bearer <token>`), so this module is auth-method-agnostic.
// When OAuth2 support ships later, only `auth.ts` changes — callers here stay
// the same.
//
// Mirrors the Notion client's `request_gates` coordination so concurrent
// chats/jobs for the same user share a bounded request cadence.
// =============================================================================

import { internal } from "../../_generated/api";
import { ToolExecutionContext } from "../registry";

const CLOZE_API = "https://api.cloze.com/v1";
const MAX_RETRIES = 4;
const CLOZE_PROVIDER = "cloze";
const REQUEST_LEASE_MS = 20_000;
const MIN_REQUEST_GAP_MS = 250;

const RETRYABLE_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(retryAfter: string | null): number | null {
  if (!retryAfter) return null;
  const seconds = Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.ceil(seconds * 1000);
}

function backoffMs(attempt: number): number {
  return Math.min(8000, 400 * 2 ** attempt);
}

function applyMinimumGap(delayMs: number): number {
  return Math.max(MIN_REQUEST_GAP_MS, Math.ceil(delayMs));
}

async function acquireRequestSlot(
  toolCtx: ToolExecutionContext,
  requestId: string,
): Promise<void> {
  while (true) {
    const now = Date.now();
    const result: { granted: boolean; waitMs: number } =
      await toolCtx.ctx.runMutation(
        internal.integrations.request_gates.claimRequestSlot,
        {
          userId: toolCtx.userId,
          provider: CLOZE_PROVIDER,
          requestId,
          now,
          leaseMs: REQUEST_LEASE_MS,
        },
      );

    if (result.granted) {
      return;
    }

    await sleep(Math.max(25, Math.min(result.waitMs, 5_000)));
  }
}

async function releaseRequestSlot(
  toolCtx: ToolExecutionContext,
  requestId: string,
  nextAllowedAt: number,
  lastResponseStatus?: number,
): Promise<void> {
  await toolCtx.ctx.runMutation(
    internal.integrations.request_gates.releaseRequestSlot,
    {
      userId: toolCtx.userId,
      provider: CLOZE_PROVIDER,
      requestId,
      now: Date.now(),
      nextAllowedAt,
      lastResponseStatus,
    },
  );
}

export function clozeHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/**
 * Gated + retrying Cloze fetch, used by every tool in this integration.
 * Callers pass an absolute path like `/people/find` (or a full URL for
 * pagination cursors).
 */
export async function clozeFetch(
  toolCtx: ToolExecutionContext,
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${CLOZE_API}${path}`;
  const headers = {
    ...clozeHeaders(accessToken),
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const requestId = crypto.randomUUID();
    await acquireRequestSlot(toolCtx, requestId);

    let response: Response | null = null;
    let delayMs = MIN_REQUEST_GAP_MS;

    try {
      response = await fetch(url, {
        ...init,
        headers,
      });

      if (
        !RETRYABLE_STATUS_CODES.has(response.status) ||
        attempt === MAX_RETRIES
      ) {
        return response;
      }

      delayMs =
        response.status === 429
          ? applyMinimumGap(
              parseRetryAfterMs(response.headers.get("retry-after")) ??
                backoffMs(attempt),
            )
          : applyMinimumGap(backoffMs(attempt));
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        throw error;
      }
      delayMs = applyMinimumGap(backoffMs(attempt));
    } finally {
      await releaseRequestSlot(
        toolCtx,
        requestId,
        Date.now() + delayMs,
        response?.status,
      );
    }

    await sleep(delayMs);
  }

  throw new Error("Unreachable");
}

// ---------------------------------------------------------------------------
// Unauthenticated validation helper (used from `connectCloze` action, before
// any oauthConnections row exists, so no request_gates coordination is
// possible). This calls `GET /v1/profile` which returns the caller's own
// user record and is the cheapest way to verify an API key is valid.
// ---------------------------------------------------------------------------

export interface ClozeValidatedProfile {
  email?: string;
  displayName?: string;
}

export async function validateClozeApiKey(
  apiKey: string,
): Promise<ClozeValidatedProfile> {
  const response = await fetch(`${CLOZE_API}/user/profile`, {
    method: "GET",
    headers: clozeHeaders(apiKey),
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(`Cloze API returned ${response.status} (unauthorized)`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Cloze API error ${response.status}: ${body.slice(0, 200) || response.statusText}`,
    );
  }

  const envelope = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  // Response shape: { errorcode: 0, profile: { email, name, first, last, ... } }
  const raw =
    typeof envelope.profile === "object" && envelope.profile !== null
      ? (envelope.profile as Record<string, unknown>)
      : envelope;

  const email =
    typeof raw.email === "string" && raw.email.length > 0
      ? (raw.email as string)
      : undefined;

  const first = typeof raw.first === "string" ? raw.first : "";
  const last = typeof raw.last === "string" ? raw.last : "";
  const combined = `${first} ${last}`.trim();
  const nameField =
    typeof raw.name === "string" && raw.name.trim().length > 0
      ? (raw.name as string).trim()
      : undefined;
  const displayName = nameField ?? (combined.length > 0 ? combined : undefined);

  return { email, displayName };
}
