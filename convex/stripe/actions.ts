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
import { ConvexError, v } from "convex/values";
import { requireAuth } from "../lib/auth";

/**
 * Create a Stripe Checkout session for a one-time Pro purchase.
 * Returns { url } — redirect the browser to this URL to complete payment.
 */
export const createCheckoutSession = action({
  args: { checkoutContext: v.optional(v.union(
    v.object({ kind: v.literal("local-runtime") }),
    v.object({ kind: v.literal("onboarding") }),
    v.object({ kind: v.literal("runtime-connect"), state: v.string(), computer: v.string() }),
  )) },
  returns: v.object({ url: v.string() }),
  handler: async (ctx, { checkoutContext }): Promise<{ url: string }> => {
    const { userId } = await requireAuth(ctx);

    const secretKey = process.env.STRIPE_SECRET_KEY;
    const priceId = process.env.STRIPE_PRICE_ID;
    const appUrl = (process.env.WEB_APP_URL ?? "").replace(/\/$/, "");

    if (!secretKey || !priceId || !appUrl) {
      throw new ConvexError({ code: "CONFIG_ERROR", message: "Stripe is not configured — missing one or more env vars: STRIPE_SECRET_KEY, STRIPE_PRICE_ID, WEB_APP_URL." });
    }

    let returnPath = "/app/settings";
    const returnParams = new URLSearchParams();
    if (checkoutContext?.kind === "local-runtime") returnPath = "/app/settings/local-runtime";
    if (checkoutContext?.kind === "onboarding") {
      returnPath = "/onboarding";
      returnParams.set("mode", "connections");
    }
    if (checkoutContext?.kind === "runtime-connect") {
      if (!/^[a-zA-Z0-9-]{16,100}$/.test(checkoutContext.state)) {
        throw new ConvexError({ code: "VALIDATION_ERROR", message: "Restart the connection from your Mac." });
      }
      returnPath = "/runtime/connect";
      returnParams.set("state", checkoutContext.state);
      returnParams.set("computer", checkoutContext.computer.slice(0, 256));
    }
    const checkoutReturn = (result: "success" | "cancelled") => {
      const params = new URLSearchParams(returnParams);
      params.set("pro", result);
      return `${appUrl}${returnPath}?${params.toString()}`;
    };
    const body = new URLSearchParams({
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      mode: "payment",
      success_url: checkoutReturn("success"),
      cancel_url: checkoutReturn("cancelled"),
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
