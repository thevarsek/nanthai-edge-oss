// convex/account/clerk_webhook.ts
// POST /clerk/webhook — Clerk user lifecycle events delivered through Svix.
// The signature is verified before the body is parsed; the delivery ID is
// recorded in the same transaction that applies the event (replay protection).

import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { readBoundedText } from "../lib/http_body";
import { verifySvixSignature } from "./svix_signature";

const MAX_BODY_BYTES = 256 * 1024;

export type ClerkWebhookEvent =
  | { kind: "user.updated"; userId: string; banned: boolean; locked: boolean }
  | { kind: "user.deleted"; userId: string }
  | { kind: "ignored"; eventType: string };

export function parseClerkWebhookEvent(raw: unknown): ClerkWebhookEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const { type, data } = raw as { type?: unknown; data?: unknown };
  if (typeof type !== "string") return null;
  if (type !== "user.updated" && type !== "user.deleted") return { kind: "ignored", eventType: type };
  if (!data || typeof data !== "object") return null;
  const { id, banned, locked } = data as { id?: unknown; banned?: unknown; locked?: unknown };
  if (typeof id !== "string" || !id) return null;
  if (type === "user.deleted") return { kind: "user.deleted", userId: id };
  return { kind: "user.updated", userId: id, banned: banned === true, locked: locked === true };
}

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function clerkWebhookHttp(ctx: ActionCtx, request: Request): Promise<Response> {
  let body: string;
  try {
    body = await readBoundedText(request, MAX_BODY_BYTES);
  } catch {
    return text("Payload too large", 413);
  }
  const deliveryId = request.headers.get("svix-id");
  const verification = await verifySvixSignature({
    secret: process.env.CLERK_WEBHOOK_SECRET,
    id: deliveryId,
    timestamp: request.headers.get("svix-timestamp"),
    signatureHeader: request.headers.get("svix-signature"),
    body,
    nowMs: Date.now(),
  });
  if (!verification.ok) {
    if (verification.reason === "missing_secret") {
      console.error("[clerk-webhook] CLERK_WEBHOOK_SECRET is not configured");
      return text("Not configured", 503);
    }
    return text("Unauthorized", 401);
  }
  let event: ClerkWebhookEvent | null;
  try {
    event = parseClerkWebhookEvent(JSON.parse(body));
  } catch {
    event = null;
  }
  if (!event || !deliveryId || deliveryId.length > 200) return text("Invalid event", 400);
  const outcome: string = await ctx.runMutation(internal.account.clerk_webhook_events.applyClerkWebhookEvent, {
    deliveryId,
    eventType: event.kind === "ignored" ? event.eventType : event.kind,
    ...(event.kind === "ignored" ? {} : { userId: event.userId }),
    ...(event.kind === "user.updated" ? { banned: event.banned, locked: event.locked } : {}),
  });
  console.info("[clerk-webhook] processed", { eventType: event.kind, outcome });
  return text(outcome, 200);
}
