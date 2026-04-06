// convex/tools/notion/client.ts
// =============================================================================
// Shared Notion API client helpers.
//
// Adds provider-wide request gating plus retry/backoff handling for Notion's
// low per-integration rate limit. The gate is coordinated in Convex so
// concurrent chats, participants, and scheduled jobs for the same user all
// respect a shared request cadence.
// =============================================================================

import { internal } from "../../_generated/api";
import { ToolExecutionContext } from "../registry";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const MAX_RETRIES = 4;
const NOTION_PROVIDER = "notion";
const REQUEST_LEASE_MS = 20_000;
const MIN_REQUEST_GAP_MS = 350;

const RETRYABLE_STATUS_CODES = new Set([409, 429, 502, 503, 504]);

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
    const result: { granted: boolean; waitMs: number } = await toolCtx.ctx.runMutation(
      internal.integrations.request_gates.claimRequestSlot,
      {
        userId: toolCtx.userId,
        provider: NOTION_PROVIDER,
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
  await toolCtx.ctx.runMutation(internal.integrations.request_gates.releaseRequestSlot, {
    userId: toolCtx.userId,
    provider: NOTION_PROVIDER,
    requestId,
    now: Date.now(),
    nextAllowedAt,
    lastResponseStatus,
  });
}

export function notionHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export async function notionFetch(
  toolCtx: ToolExecutionContext,
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${NOTION_API}${path}`;
  const headers = {
    ...notionHeaders(accessToken),
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
