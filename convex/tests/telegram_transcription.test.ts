import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { getFunctionName } from "convex/server";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { ingestTelegramMedia } from "../channels/telegram/media_actions";

for (const zdrEnabled of [true, false]) {
  test(`Telegram transcribes using Whisper Large V3 and preserves ZDR=${zdrEnabled}`, async () => {
    const previousToken = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const scope = {
      userId: "user", attemptId: "attempt", fence: 1,
      files: [{ fileId: "voice", type: "voice" }],
      uploads: [{ fileId: "voice", type: "audio", storageId: "storage", mimeType: "audio/ogg", name: "voice.ogg" }],
    };
    let committed: Record<string, unknown> | undefined;
    const ctx = {
      runMutation: async (reference: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) => {
        const name = getFunctionName(reference);
        if (name === "channels/telegram/media_scope:get") return scope;
        if (name === "execution/operations:prepare") return { decision: "execute" };
        if (name === "channels/telegram/media_scope:commitTranscript") committed = args;
        return null;
      },
      runQuery: async () => ({ zdrEnabled }),
      storage: { getUrl: async () => "https://storage.example/voice" },
    } as unknown as ActionCtx;
    const requests: Array<{ url: string; body?: string }> = [];
    mock.method(globalThis, "fetch", async (url: string, options?: RequestInit) => {
      requests.push({ url, body: options?.body as string | undefined });
      if (url === "https://storage.example/voice") return new Response(new Uint8Array([1, 2, 3]));
      assert.equal(url, "https://openrouter.ai/api/v1/audio/transcriptions");
      return Response.json({ text: "Hello", usage: { cost: 0.001 } });
    });
    try {
      await ingestTelegramMedia(ctx, { inboxId: "inbox" as Id<"channelInbox"> }, { getKey: async () => "test-key" });
      assert.equal(requests.length, 2);
      const body = JSON.parse(requests[1].body!);
      assert.equal(body.model, "openai/whisper-large-v3");
      assert.deepEqual(body.provider, { zdr: zdrEnabled });
      assert.equal(body.input_audio.data, "AQID");
      assert.equal(committed?.modelId, "openai/whisper-large-v3");
      assert.equal(committed?.text, "Hello");
    } finally {
      mock.restoreAll();
      if (previousToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
      else process.env.TELEGRAM_BOT_TOKEN = previousToken;
    }
  });
}
