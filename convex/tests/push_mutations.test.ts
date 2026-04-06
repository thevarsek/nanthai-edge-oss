import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import { registerDeviceToken } from "../push/mutations";

function buildRegisterCtx(existingToken: Record<string, unknown> | null) {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const replacements: Array<{ id: string; value: Record<string, unknown> }> = [];

  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      query: (table: string) => ({
        withIndex: (index: string) => ({
          first: async () => {
            if (table === "deviceTokens" && index === "by_token") {
              return existingToken;
            }
            return null;
          },
        }),
      }),
      replace: async (id: string, value: Record<string, unknown>) => {
        replacements.push({ id, value });
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return "new_token_id";
      },
    },
  } as any;

  return { ctx, inserts, replacements };
}

test("registerDeviceToken rejects APNs registration without environment", async () => {
  const { ctx } = buildRegisterCtx(null);

  await assert.rejects(
    (registerDeviceToken as any)._handler(ctx, {
      token: "apns_token",
      provider: "apns",
      platform: "ios",
    }),
    (error: unknown) => {
      assert.ok(error instanceof ConvexError);
      return (error as ConvexError<any>).data?.code === "INVALID_ARGUMENT";
    },
  );
});

test("registerDeviceToken rejects environment for FCM provider", async () => {
  const { ctx } = buildRegisterCtx(null);

  await assert.rejects(
    (registerDeviceToken as any)._handler(ctx, {
      token: "fcm_token",
      provider: "fcm",
      platform: "android",
      environment: "production",
    }),
    (error: unknown) => {
      assert.ok(error instanceof ConvexError);
      return (error as ConvexError<any>).data?.code === "INVALID_ARGUMENT";
    },
  );
});

test("registerDeviceToken rejects web push registration without subscription", async () => {
  const { ctx } = buildRegisterCtx(null);

  await assert.rejects(
    (registerDeviceToken as any)._handler(ctx, {
      token: "https://push.example/subscription",
      provider: "webpush",
      platform: "web",
    }),
    (error: unknown) => {
      assert.ok(error instanceof ConvexError);
      return (error as ConvexError<any>).data?.code === "INVALID_ARGUMENT";
    },
  );
});

test("registerDeviceToken replaces existing token and normalizes provider payload", async () => {
  const { ctx, replacements, inserts } = buildRegisterCtx({
    _id: "token_existing",
    userId: "user_2",
    token: "same_token",
    provider: "apns",
    environment: "sandbox",
  });

  const result = await (registerDeviceToken as any)._handler(ctx, {
    token: "same_token",
    provider: "fcm",
    platform: "android",
  });

  assert.equal(result, "token_existing");
  assert.equal(inserts.length, 0);
  assert.equal(replacements.length, 1);
  assert.deepEqual(replacements[0], {
    id: "token_existing",
    value: {
      userId: "user_1",
      token: "same_token",
      platform: "android",
      provider: "fcm",
      updatedAt: replacements[0].value.updatedAt,
    },
  });
});

test("registerDeviceToken stores web push subscription payload", async () => {
  const { ctx, inserts } = buildRegisterCtx(null);

  const result = await (registerDeviceToken as any)._handler(ctx, {
    token: "https://push.example/subscription",
    provider: "webpush",
    platform: "web",
    subscription: "{\"endpoint\":\"https://push.example/subscription\"}",
  });

  assert.equal(result, "new_token_id");
  assert.equal(inserts.length, 1);
  assert.deepEqual(inserts[0]?.value, {
    userId: "user_1",
    token: "https://push.example/subscription",
    platform: "web",
    provider: "webpush",
    subscription: "{\"endpoint\":\"https://push.example/subscription\"}",
    updatedAt: inserts[0]?.value.updatedAt,
  });
});
