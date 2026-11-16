import { ConvexError } from "convex/values";
import { z } from "zod";

const subscriptionSchema = z.object({
  endpoint: z.string(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

/** Check again at send time so existing rows cannot bypass endpoint validation. */
export function parseWebPushSubscription(raw: string) {
  try {
    const subscription = subscriptionSchema.parse(JSON.parse(raw));
    const url = new URL(subscription.endpoint);
    const host = url.hostname.toLowerCase();
    const allowed = host === "fcm.googleapis.com" || host === "web.push.apple.com"
      || host.endsWith(".push.services.mozilla.com") || host.endsWith(".notify.windows.com");
    if (!allowed || url.protocol !== "https:" || url.username || url.password
      || url.port || url.hash) throw new Error("Invalid push endpoint");
    return subscription;
  } catch {
    throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Invalid web push subscription." });
  }
}
