export interface StripeEvent {
  type: string;
  data: { object: unknown };
}

export interface StripeCheckoutSession {
  id: string;
  payment_intent?: string | null;
  payment_status?: string;
  mode?: string;
  metadata?: Record<string, string>;
  amount_total?: number;
  currency?: string;
}

export interface StripeCharge {
  id: string;
  refunded?: boolean;
  amount_refunded?: number;
  payment_intent?: string | null;
}

export type StripeEntitlementUpdate =
  | {
      kind: "grant";
      userId: string;
      stripeSessionId: string;
      paymentIntentId?: string;
    }
  | {
      kind: "revoke";
      status: "refunded" | "revoked";
      externalPurchaseIds: string[];
      paymentIntentId?: string;
      chargeId?: string;
    }
  | {
      // A dispute closed in the merchant's favour: undo the dispute revocation.
      kind: "restore";
      externalPurchaseIds: string[];
      paymentIntentId?: string;
      chargeId?: string;
    };

export interface StripeDispute {
  id: string;
  charge?: string | { id?: string } | null;
  payment_intent?: string | { id?: string } | null;
}

const stripeId = (value: string | { id?: string } | null | undefined): string | undefined =>
  typeof value === "string" ? value : value?.id ?? undefined;

export function extractStripeEntitlementUpdate(
  event: StripeEvent,
): StripeEntitlementUpdate | null {
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object as StripeCheckoutSession;
    const userId = session.metadata?.convexUserId;
    if (!userId || session.mode !== "payment" || session.payment_status !== "paid") {
      return null;
    }
    return {
      kind: "grant",
      userId,
      stripeSessionId: session.id,
      paymentIntentId: session.payment_intent ?? undefined,
    };
  }

  // Failed delayed payments never grant access; completed unpaid sessions were ignored.
  if (event.type === "checkout.session.async_payment_failed") return null;

  // Business rule: only full refunds revoke Pro. Partial refunds are ignored.
  if (event.type === "refund.created" || event.type === "refund.updated") {
    return null;
  }

  if (event.type === "charge.refunded") {
    const charge = event.data.object as StripeCharge;
    if (charge.refunded !== true) {
      return null;
    }
    return {
      kind: "revoke",
      status: "refunded",
      externalPurchaseIds: [charge.id],
      paymentIntentId: charge.payment_intent ?? undefined,
      chargeId: charge.id,
    };
  }

  // Chargebacks: funds withdrawn revokes Pro; funds reinstated restores it.
  if (event.type === "charge.dispute.funds_withdrawn" || event.type === "charge.dispute.funds_reinstated") {
    const dispute = event.data.object as StripeDispute;
    const chargeId = stripeId(dispute.charge);
    const paymentIntentId = stripeId(dispute.payment_intent);
    if (!chargeId && !paymentIntentId) return null;
    const match = { externalPurchaseIds: chargeId ? [chargeId] : [], paymentIntentId, chargeId };
    return event.type === "charge.dispute.funds_withdrawn"
      ? { kind: "revoke", status: "revoked", ...match }
      : { kind: "restore", ...match };
  }

  return null;
}

export async function verifyStripeSignature(
  payload: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  try {
    const parts = Object.fromEntries(
      signature.split(",").map((part) => part.split("=")),
    ) as Record<string, string>;

    const timestamp = parts["t"];
    const v1 = parts["v1"];
    if (!timestamp || !v1) return false;

    const signedPayload = `${timestamp}.${payload}`;
    const keyData = new TextEncoder().encode(secret);
    const msgData = new TextEncoder().encode(signedPayload);

    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, msgData);
    const expected = Array.from(new Uint8Array(sig))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    return expected === v1;
  } catch {
    return false;
  }
}
