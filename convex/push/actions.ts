"use node";

// convex/push/actions.ts
// =============================================================================
// APNs push notification delivery — internal action.
//
// This implementation routes APNs tokens only. It signs a JWT with ES256 using
// the P8 key from env vars, POSTs to APNs, and deletes stale APNs tokens when
// APNs returns 410 Gone.
// =============================================================================

import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import webpush from "web-push";
import { buildApnsPayload, buildFcmPayload, buildWebPushPayload, splitPushTokensByProvider } from "./payloads";
import { signAPNsJWT } from "./apns_jwt";

/**
 * Send a push notification to all registered devices for a user.
 * Called internally after scheduled job completion or research paper completion.
 */
export const sendPushNotification = internalAction({
  args: {
    userId: v.string(),
    title: v.string(),
    body: v.string(),
    chatId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // 1. Load all device tokens for the user
    const allTokens = await ctx.runQuery(
      internal.push.queries.getDeviceTokens,
      { userId: args.userId },
    );

    if (allTokens.length === 0) {
      console.log(`[push] No device tokens for user ${args.userId}, skipping`);
      return;
    }

    // 2. Load APNs config from env vars
    const keyId = process.env.APNS_KEY_ID;
    const teamId = process.env.APNS_TEAM_ID;
    const privateKey = process.env.APNS_PRIVATE_KEY;
    const bundleId = process.env.APNS_BUNDLE_ID;
    const apnsEnv = process.env.APNS_ENVIRONMENT ?? "sandbox";

    // 3. Split tokens by provider and environment
    const targetApnsEnv = apnsEnv === "production" ? "production" : "sandbox";
    const { apnsTokens, fcmTokens, webPushTokens } = splitPushTokensByProvider(
      allTokens,
      targetApnsEnv,
    );

    if (apnsTokens.length > 0) {
      if (!keyId || !teamId || !privateKey || !bundleId) {
        console.error("[push] Missing APNs env vars (APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY, APNS_BUNDLE_ID)");
      } else {
        await sendApnsNotifications(ctx, {
          tokens: apnsTokens,
          keyId,
          teamId,
          privateKey,
          bundleId,
          apnsEnv,
          title: args.title,
          body: args.body,
          chatId: args.chatId,
        });
      }
    }

    if (fcmTokens.length > 0) {
      const fcmServerKey = process.env.FCM_SERVER_KEY;
      if (!fcmServerKey) {
        console.error("[push] Missing FCM_SERVER_KEY; skipping FCM delivery");
      } else {
        await sendFcmNotifications(ctx, {
          tokens: fcmTokens,
          serverKey: fcmServerKey,
          title: args.title,
          body: args.body,
          chatId: args.chatId,
        });
      }
    }

    if (webPushTokens.length > 0) {
      const vapidPublicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
      const vapidPrivateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
      const vapidSubject = process.env.WEB_PUSH_VAPID_SUBJECT;
      if (!vapidSubject) {
        console.error("[push] Missing WEB_PUSH_VAPID_SUBJECT env var; skipping web push delivery");
      } else if (!vapidPublicKey || !vapidPrivateKey) {
        console.error("[push] Missing web push VAPID env vars; skipping web push delivery");
      } else {
        await sendWebPushNotifications(ctx, {
          tokens: webPushTokens,
          vapidPublicKey,
          vapidPrivateKey,
          vapidSubject,
          title: args.title,
          body: args.body,
          chatId: args.chatId,
        });
      }
    }
  },
});


async function sendApnsNotifications(
  ctx: ActionCtx,
  args: {
    tokens: Array<{ _id: Id<"deviceTokens">; token: string }>;
    keyId: string;
    teamId: string;
    privateKey: string;
    bundleId: string;
    apnsEnv: string;
    title: string;
    body: string;
    chatId?: string;
  },
): Promise<void> {
  const jwt = await signAPNsJWT(args.keyId, args.teamId, args.privateKey);
  const payloadStr = JSON.stringify(
    buildApnsPayload({ title: args.title, body: args.body, chatId: args.chatId }),
  );
  const host = args.apnsEnv === "production"
    ? "api.push.apple.com"
    : "api.sandbox.push.apple.com";

  for (const tokenDoc of args.tokens) {
    const url = `https://${host}/3/device/${tokenDoc.token}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "authorization": `bearer ${jwt}`,
          "apns-topic": args.bundleId,
          "apns-push-type": "alert",
          "apns-priority": "10",
          "content-type": "application/json",
        },
        body: payloadStr,
      });

      if (response.status === 200) {
        console.log(`[push] APNs sent to ${tokenDoc.token.slice(0, 8)}...`);
      } else if (response.status === 410) {
        console.log(`[push] APNs token ${tokenDoc.token.slice(0, 8)}... is stale (410), deleting`);
        await ctx.runMutation(internal.push.mutations_internal.deleteStaleToken, {
          tokenId: tokenDoc._id,
        });
      } else {
        const errorBody = await response.text();
        console.error(`[push] APNs ${response.status}: ${errorBody}`);
      }
    } catch (error) {
      console.error(`[push] APNs failed for ${tokenDoc.token.slice(0, 8)}...:`, error);
    }
  }
}

async function sendFcmNotifications(
  ctx: ActionCtx,
  args: {
    tokens: Array<{ _id: Id<"deviceTokens">; token: string }>;
    serverKey: string;
    title: string;
    body: string;
    chatId?: string;
  },
): Promise<void> {
  const basePayload = buildFcmPayload({
    title: args.title,
    body: args.body,
    chatId: args.chatId,
  });

  for (const tokenDoc of args.tokens) {
    try {
      const response = await fetch("https://fcm.googleapis.com/fcm/send", {
        method: "POST",
        headers: {
          authorization: `key=${args.serverKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          to: tokenDoc.token,
          ...basePayload,
        }),
      });

      const rawText = await response.text();

      if (response.status >= 200 && response.status < 300) {
        const body = parseFcmResponseBody(rawText);
        if (body === null) {
          console.error(`[push] FCM 2xx with invalid JSON body: ${rawText}`);
          continue;
        }

        const firstError = extractFirstFcmError(body);
        if (firstError === null) {
          console.error(`[push] FCM 2xx with invalid results shape: ${rawText}`);
          continue;
        }

        if (firstError === "NotRegistered" || firstError === "InvalidRegistration") {
          console.log(`[push] FCM token ${tokenDoc.token.slice(0, 8)}... is stale (${firstError}), deleting`);
          await ctx.runMutation(internal.push.mutations_internal.deleteStaleToken, {
            tokenId: tokenDoc._id,
          });
          continue;
        }

        if (firstError) {
          console.error(`[push] FCM delivery failed for ${tokenDoc.token.slice(0, 8)}...: ${firstError}`);
          continue;
        }

        console.log(`[push] FCM sent to ${tokenDoc.token.slice(0, 8)}...`);
      } else {
        console.error(`[push] FCM ${response.status}: ${rawText}`);
      }
    } catch (error) {
      console.error(`[push] FCM failed for ${tokenDoc.token.slice(0, 8)}...:`, error);
    }
  }
}

async function sendWebPushNotifications(
  ctx: ActionCtx,
  args: {
    tokens: Array<{ _id: Id<"deviceTokens">; token: string; subscription?: string }>; 
    vapidPublicKey: string;
    vapidPrivateKey: string;
    vapidSubject: string;
    title: string;
    body: string;
    chatId?: string;
  },
): Promise<void> {
  webpush.setVapidDetails(args.vapidSubject, args.vapidPublicKey, args.vapidPrivateKey);
  const payload = JSON.stringify(buildWebPushPayload({ title: args.title, body: args.body, chatId: args.chatId }));

  for (const tokenDoc of args.tokens) {
    if (!tokenDoc.subscription) continue;
    try {
      const subscription = JSON.parse(tokenDoc.subscription) as webpush.PushSubscription;
      await webpush.sendNotification(subscription, payload);
      console.log(`[push] Web push sent to ${tokenDoc.token.slice(0, 8)}...`);
    } catch (error) {
      const statusCode = typeof error === "object" && error !== null && "statusCode" in error
        ? Number((error as { statusCode?: unknown }).statusCode)
        : undefined;
      if (statusCode === 404 || statusCode === 410) {
        console.log(`[push] Web push token ${tokenDoc.token.slice(0, 8)}... is stale (${statusCode}), deleting`);
        await ctx.runMutation(internal.push.mutations_internal.deleteStaleToken, { tokenId: tokenDoc._id });
      } else {
        console.error(`[push] Web push failed for ${tokenDoc.token.slice(0, 8)}...:`, error);
      }
    }
  }
}

export function parseFcmResponseBody(rawText: string): unknown | null {
  try {
    return JSON.parse(rawText);
  } catch {
    return null;
  }
}

export function extractFirstFcmError(body: unknown): string | null {
  if (!isPlainObject(body)) {
    return null;
  }

  const results = body.results;
  if (!Array.isArray(results) || results.length === 0) {
    return null;
  }

  const firstResult = results[0];
  if (!isPlainObject(firstResult)) {
    return null;
  }

  if ("error" in firstResult && typeof firstResult.error !== "string") {
    return null;
  }

  return typeof firstResult.error === "string" ? firstResult.error : "";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
