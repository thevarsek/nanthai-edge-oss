import assert from "node:assert/strict";
import test from "node:test";

import {
  buildApnsPayload,
  buildFcmPayload,
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
  const withChat = buildApnsPayload({ title: "Done", body: "Task finished", chatId: "chat_123" });
  assert.deepEqual(withChat, {
    aps: {
      alert: { title: "Done", body: "Task finished" },
      sound: "default",
    },
    chatId: "chat_123",
  });

  const withoutChat = buildApnsPayload({ title: "Done", body: "Task finished" });
  assert.equal("chatId" in withoutChat, false);
});

test("buildFcmPayload mirrors title/body and deep-link data", () => {
  const withChat = buildFcmPayload({ title: "Done", body: "Task finished", chatId: "chat_123" });
  assert.deepEqual(withChat, {
    notification: {
      title: "Done",
      body: "Task finished",
    },
    data: {
      chatId: "chat_123",
    },
  });

  const withoutChat = buildFcmPayload({ title: "Done", body: "Task finished" });
  assert.deepEqual(withoutChat, {
    notification: {
      title: "Done",
      body: "Task finished",
    },
    data: {},
  });
});
