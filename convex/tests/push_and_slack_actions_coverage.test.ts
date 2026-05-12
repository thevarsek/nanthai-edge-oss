import assert from "node:assert/strict";
import test from "node:test";
import webpush from "web-push";

import { sendPushNotification } from "../push/actions";
import { listSlackMcpTools } from "../tools/slack/diagnose";

const PUSH_ENV_KEYS = [
  "APNS_KEY_ID",
  "APNS_TEAM_ID",
  "APNS_PRIVATE_KEY",
  "APNS_BUNDLE_ID",
  "APNS_ENVIRONMENT",
  "FCM_PROJECT_ID",
  "FCM_CLIENT_EMAIL",
  "FCM_PRIVATE_KEY",
  "WEB_PUSH_VAPID_PUBLIC_KEY",
  "WEB_PUSH_VAPID_PRIVATE_KEY",
  "WEB_PUSH_VAPID_SUBJECT",
];

function withCleanPushEnv<T>(run: () => Promise<T>): Promise<T> {
  const original = new Map(PUSH_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of PUSH_ENV_KEYS) {
    delete process.env[key];
  }

  return run().finally(() => {
    for (const key of PUSH_ENV_KEYS) {
      const value = original.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

test("sendPushNotification no-ops when the user has no registered tokens", async () => {
  const queries: Array<Record<string, unknown>> = [];

  await withCleanPushEnv(async () => {
    await (sendPushNotification as any)._handler({
      runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
        queries.push(args);
        return [];
      },
      runMutation: async () => {
        throw new Error("no mutations expected");
      },
    }, {
      userId: "user_1",
      title: "Done",
      body: "Your job finished.",
    });
  });

  assert.deepEqual(queries, [{ userId: "user_1" }]);
});

test("sendPushNotification skips provider branches with missing credentials", async () => {
  const deletedTokens: unknown[] = [];

  await withCleanPushEnv(async () => {
    await (sendPushNotification as any)._handler({
      runQuery: async () => [
        {
          _id: "apns_1",
          token: "apns-token",
          provider: "apns",
          environment: "sandbox",
        },
        {
          _id: "fcm_1",
          token: "fcm-token",
          provider: "fcm",
        },
        {
          _id: "web_1",
          token: "web-token",
          provider: "webpush",
          subscription: JSON.stringify({ endpoint: "https://push.example/sub" }),
        },
      ],
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        deletedTokens.push(args.tokenId);
      },
    }, {
      userId: "user_1",
      title: "Done",
      body: "Your job finished.",
      chatId: "chat_1",
      category: "scheduled_job",
    });
  });

  assert.deepEqual(deletedTokens, []);
});

test("sendPushNotification deletes stale web push subscriptions", async () => {
  const deletedTokens: unknown[] = [];
  const originalSetVapidDetails = webpush.setVapidDetails;
  const originalSendNotification = webpush.sendNotification;

  try {
    (webpush as any).setVapidDetails = () => undefined;
    (webpush as any).sendNotification = async () => {
      throw { statusCode: 410 };
    };

    await withCleanPushEnv(async () => {
      process.env.WEB_PUSH_VAPID_PUBLIC_KEY = "public";
      process.env.WEB_PUSH_VAPID_PRIVATE_KEY = "private";
      process.env.WEB_PUSH_VAPID_SUBJECT = "mailto:support@example.com";

      await (sendPushNotification as any)._handler({
        runQuery: async () => [
          {
            _id: "web_1",
            token: "web-token",
            provider: "webpush",
            subscription: JSON.stringify({
              endpoint: "https://push.example/sub",
              keys: { p256dh: "p256dh", auth: "auth" },
            }),
          },
        ],
        runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
          deletedTokens.push(args.tokenId);
        },
      }, {
        userId: "user_1",
        title: "Done",
        body: "Your job finished.",
      });
    });
  } finally {
    (webpush as any).setVapidDetails = originalSetVapidDetails;
    (webpush as any).sendNotification = originalSendNotification;
  }

  assert.deepEqual(deletedTokens, ["web_1"]);
});

test("sendPushNotification handles web push success, malformed subscriptions, and non-stale failures", async () => {
  const deletedTokens: unknown[] = [];
  const sentPayloads: string[] = [];
  const originalSetVapidDetails = webpush.setVapidDetails;
  const originalSendNotification = webpush.sendNotification;

  try {
    (webpush as any).setVapidDetails = () => undefined;
    (webpush as any).sendNotification = async (_subscription: unknown, payload: string) => {
      sentPayloads.push(payload);
      if (sentPayloads.length === 2) {
        throw { statusCode: 500 };
      }
    };

    await withCleanPushEnv(async () => {
      process.env.WEB_PUSH_VAPID_PUBLIC_KEY = "public";
      process.env.WEB_PUSH_VAPID_PRIVATE_KEY = "private";
      process.env.WEB_PUSH_VAPID_SUBJECT = "mailto:support@example.com";

      await (sendPushNotification as any)._handler({
        runQuery: async () => [
          {
            _id: "web_success",
            token: "web-success",
            provider: "webpush",
            subscription: JSON.stringify({
              endpoint: "https://push.example/success",
              keys: { p256dh: "p256dh", auth: "auth" },
            }),
          },
          {
            _id: "web_bad_json",
            token: "web-bad-json",
            provider: "webpush",
            subscription: "{not json",
          },
          {
            _id: "web_server_error",
            token: "web-server-error",
            provider: "webpush",
            subscription: JSON.stringify({
              endpoint: "https://push.example/error",
              keys: { p256dh: "p256dh", auth: "auth" },
            }),
          },
          {
            _id: "web_missing_subscription",
            token: "web-missing",
            provider: "webpush",
          },
        ],
        runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
          deletedTokens.push(args.tokenId);
        },
      }, {
        userId: "user_1",
        title: "Done",
        body: "Your job finished.",
        chatId: "chat_1",
        category: "chat_completion",
      });
    });
  } finally {
    (webpush as any).setVapidDetails = originalSetVapidDetails;
    (webpush as any).sendNotification = originalSendNotification;
  }

  assert.equal(sentPayloads.length, 2);
  assert.match(sentPayloads[0] ?? "", /chat_1/);
  assert.deepEqual(deletedTokens, []);
});

test("listSlackMcpTools rejects users without a Slack connection before probing MCP", async () => {
  await assert.rejects(
    (listSlackMcpTools as any)._handler({
      runQuery: async () => null,
    }, { userId: "user_1" }),
    /No Slack connection for user user_1/,
  );
});
