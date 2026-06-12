import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { getFunctionName } from "convex/server";

import { internal } from "../_generated/api";
import { submitVideoGenerationHandler } from "../chat/actions_video_generation";

test("submitVideoGenerationHandler sends provider.zdr for ZDR-capable video models", async (t) => {
  t.after(() => mock.restoreAll());
  let requestBody: Record<string, unknown> = {};
  mock.method(globalThis, "fetch", async (_url: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        id: "video_job_or_1",
        polling_url: "https://openrouter.ai/video/poll/1",
        status: "pending",
      }),
      text: async () => "",
    } as any;
  }) as any;

  const keyRef = getFunctionName(internal.scheduledJobs.queries.getUserApiKey);
  const prefsRef = getFunctionName(internal.chat.queries.getUserPreferences);
  const messageRef = getFunctionName(internal.chat.queries.getMessageInternal);
  const capsRef = getFunctionName(internal.chat.queries.getModelCapabilities);
  const generationJobRef = getFunctionName(internal.chat.queries.getGenerationJobInternal);

  await submitVideoGenerationHandler({
    runQuery: async (ref: unknown, args: Record<string, unknown>) => {
      const name = getFunctionName(ref as any);
      if (name === generationJobRef) return { _id: "job_1", status: "queued" };
      if (name === keyRef) return "sk-test";
      if (name === prefsRef) return { zdrEnabled: true };
      if (name === messageRef && args.messageId === "msg_user") {
        return {
          _id: "msg_user",
          content: "Generate a short launch teaser.",
          attachments: [],
        };
      }
      if (name === capsRef) {
        return {
          hasZdrEndpoint: true,
          videoCapabilities: {
            supportedDurations: [5],
            supportedAspectRatios: ["16:9"],
            supportedResolutions: ["720p"],
            supportedFrameImages: [],
          },
        };
      }
      throw new Error(`unexpected query ${name}`);
    },
    runMutation: async (ref: unknown) => {
      const name = getFunctionName(ref as any);
      if (name === getFunctionName(internal.chat.mutations.createVideoJob)) {
        return "video_job_1";
      }
      return null;
    },
    scheduler: { runAfter: async () => undefined },
    storage: { getUrl: async () => null },
  } as any, {
    chatId: "chat_1" as any,
    userMessageId: "msg_user" as any,
    assistantMessageIds: ["msg_assistant" as any],
    generationJobIds: ["job_1" as any],
    participant: {
      modelId: "openai/sora-2",
      messageId: "msg_assistant" as any,
      jobId: "job_1" as any,
    },
    userId: "user_1",
    videoConfig: { duration: 5, aspectRatio: "16:9", generateAudio: true },
  });

  assert.deepEqual(requestBody.provider, { sort: "latency", zdr: true });
});
