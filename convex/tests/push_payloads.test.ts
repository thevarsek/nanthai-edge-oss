import assert from "node:assert/strict";
import test from "node:test";

import {
  ANDROID_NOTIFICATION_CHANNEL_ID,
  buildApnsPayload,
  buildFcmPayload,
  buildWebPushPayload,
  splitPushTokensByProvider,
} from "../push/payloads";

test("splitPushTokensByProvider routes APNs by environment and preserves FCM tokens", () => {
  const tokens = [
    { _id: "1" as any, token: "apns_sandbox", provider: "apns" as const, environment: "sandbox" as const },
    { _id: "2" as any, token: "apns_prod", provider: "apns" as const, environment: "production" as const },
    { _id: "3" as any, token: "fcm_any", provider: "fcm" as const },
    { _id: "4" as any, token: "legacy_apns_no_provider" },
  ];

  const sandbox = splitPushTokensByProvider(tokens, "sandbox");
  assert.deepEqual(
    sandbox.apnsTokens.map((t) => t.token),
    ["apns_sandbox", "legacy_apns_no_provider"],
  );
  assert.deepEqual(sandbox.fcmTokens.map((t) => t.token), ["fcm_any"]);

  const production = splitPushTokensByProvider(tokens, "production");
  assert.deepEqual(production.apnsTokens.map((t) => t.token), ["apns_prod"]);
  assert.deepEqual(production.fcmTokens.map((t) => t.token), ["fcm_any"]);
});

test("buildApnsPayload includes aps envelope and optional chatId", () => {
  const withChat = buildApnsPayload({
    title: "Done",
    body: "Task finished",
    chatId: "chat_123",
    category: "CHAT_COMPLETION",
  });
  assert.deepEqual(withChat, {
    aps: {
      alert: { title: "Done", body: "Task finished" },
      sound: "default",
      category: "CHAT_COMPLETION",
    },
    chatId: "chat_123",
    category: "CHAT_COMPLETION",
  });

  const withoutChat = buildApnsPayload({ title: "Done", body: "Task finished" });
  assert.equal("chatId" in withoutChat, false);
});

test("buildFcmPayload builds an HTTP v1 message with Android channel and deep-link data", () => {
  const withChat = buildFcmPayload("fcm_token_123", {
    title: "Done",
    body: "Task finished",
    chatId: "chat_123",
    category: "CHAT_COMPLETION",
  });
  assert.deepEqual(withChat, {
    message: {
      token: "fcm_token_123",
      notification: {
        title: "Done",
        body: "Task finished",
      },
      data: {
        chatId: "chat_123",
        category: "CHAT_COMPLETION",
      },
      android: {
        priority: "high",
        notification: {
          channelId: ANDROID_NOTIFICATION_CHANNEL_ID,
        },
      },
    },
  });

  const withoutChat = buildFcmPayload("fcm_token_456", {
    title: "Done",
    body: "Task finished",
  });
  assert.deepEqual(withoutChat, {
    message: {
      token: "fcm_token_456",
      notification: {
        title: "Done",
        body: "Task finished",
      },
      data: {},
      android: {
        priority: "high",
        notification: {
          channelId: ANDROID_NOTIFICATION_CHANNEL_ID,
        },
      },
    },
  });
});

test("buildWebPushPayload includes optional chatId and category", () => {
  const withMetadata = buildWebPushPayload({
    title: "Done",
    body: "Task finished",
    chatId: "chat_123",
    category: "CHAT_COMPLETION",
  });
  assert.deepEqual(withMetadata, {
    title: "Done",
    body: "Task finished",
    chatId: "chat_123",
    category: "CHAT_COMPLETION",
  });
});
