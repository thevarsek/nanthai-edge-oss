import type { Doc } from "../_generated/dataModel";

export type PushTokenDoc = Pick<
  Doc<"deviceTokens">,
  "_id" | "token" | "provider" | "environment" | "subscription"
>;

export type PushMessage = {
  title: string;
  body: string;
  chatId?: string;
};

export function splitPushTokensByProvider(
  tokens: PushTokenDoc[],
  targetApnsEnvironment: "sandbox" | "production",
): {
  apnsTokens: PushTokenDoc[];
  fcmTokens: PushTokenDoc[];
  webPushTokens: PushTokenDoc[];
} {
  const apnsTokens: PushTokenDoc[] = [];
  const fcmTokens: PushTokenDoc[] = [];
  const webPushTokens: PushTokenDoc[] = [];

  for (const token of tokens) {
    const provider = token.provider ?? "apns";

    if (provider === "fcm") {
      fcmTokens.push(token);
      continue;
    }

    if (provider === "webpush") {
      webPushTokens.push(token);
      continue;
    }

    const tokenEnvironment = token.environment ?? "sandbox";
    if (tokenEnvironment === targetApnsEnvironment) {
      apnsTokens.push(token);
    }
  }

  return { apnsTokens, fcmTokens, webPushTokens };
}

export function buildApnsPayload(message: PushMessage): Record<string, unknown> {
  return {
    aps: {
      alert: {
        title: message.title,
        body: message.body,
      },
      sound: "default",
    },
    ...(message.chatId ? { chatId: message.chatId } : {}),
  };
}

export function buildFcmPayload(message: PushMessage): Record<string, unknown> {
  return {
    notification: {
      title: message.title,
      body: message.body,
    },
    data: {
      ...(message.chatId ? { chatId: message.chatId } : {}),
    },
  };
}

export function buildWebPushPayload(message: PushMessage): Record<string, unknown> {
  return {
    title: message.title,
    body: message.body,
    ...(message.chatId ? { chatId: message.chatId } : {}),
  };
}
