// convex/stripe/actions.ts
// =============================================================================
// Stripe Checkout — create a checkout session for NanthAI Pro (web).
//
// Requires env vars:
//   STRIPE_SECRET_KEY   — Stripe secret key
//   STRIPE_PRICE_ID     — Price ID for the one-time Pro product
//   WEB_APP_URL         — Base URL of the web app (e.g. https://your-domain.com)
// =============================================================================

import { action } from "../_generated/server";
import { ConvexError } from "convex/values";
import { requireAuth } from "../lib/auth";

/**
 * Create a Stripe Checkout session for a one-time Pro purchase.
 * Returns { url } — redirect the browser to this URL to complete payment.
 */
export const createCheckoutSession = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    const { userId } = await requireAuth(ctx);

    const secretKey = process.env.STRIPE_SECRET_KEY;
    const priceId = process.env.STRIPE_PRICE_ID;
    const appUrl = (process.env.WEB_APP_URL ?? "").replace(/\/$/, "");

    if (!secretKey || !priceId || !appUrl) {
      throw new ConvexError({ code: "CONFIG_ERROR", message: "Stripe is not configured — missing one or more env vars: STRIPE_SECRET_KEY, STRIPE_PRICE_ID, WEB_APP_URL." });
    }

    const body = new URLSearchParams({
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      mode: "payment",
      success_url: `${appUrl}/app/settings?pro=success`,
      cancel_url: `${appUrl}/app/settings?pro=cancelled`,
      "metadata[convexUserId]": userId,
      "payment_intent_data[metadata][convexUserId]": userId,
    });

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ConvexError({ code: "EXTERNAL_SERVICE", message: `Stripe checkout error: ${response.status} ${text}` });
    }

    const session = (await response.json()) as { url: string };
    return { url: session.url };
  },
});
