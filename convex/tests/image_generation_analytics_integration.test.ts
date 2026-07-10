import assert from "node:assert/strict";
import test from "node:test";

import { generateForParticipant } from "../chat/actions_run_generation_participant";
import { runGenerationParticipantHandler } from "../chat/actions_run_generation_participant_action";
import type { RunGenerationParticipantArgs } from "../chat/generation_continuation_shared";

function participantArgs(): RunGenerationParticipantArgs {
  return {
    chatId: "chat_1",
    userMessageId: "message_user",
    assistantMessageIds: ["message_assistant"],
    generationJobIds: ["job_1"],
    participant: {
      modelId: "openai/gpt-image-2",
      messageId: "message_assistant",
      jobId: "job_1",
    },
    userId: "user_1",
    expandMultiModelGroups: false,
    webSearchEnabled: false,
    effectiveIntegrations: [],
    isPro: true,
    allowSubagents: false,
  } as unknown as RunGenerationParticipantArgs;
}

test("dedicated image participant results attach generated counts to terminal analytics", async () => {
  const originalFetch = globalThis.fetch;
  const mutations: Array<Record<string, unknown>> = [];
  let storedCount = 0;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    data: [
      { b64_json: "AAEC", media_type: "image/png" },
      { b64_json: "AwQF", media_type: "image/png" },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
  }), {
    status: 200,
    headers: { "X-Generation-Id": "generation_image" },
  })) as typeof fetch;

  try {
    const result = await generateForParticipant({
      ctx: {
        runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
          if ("jobId" in args) return false;
          if ("userId" in args) return null;
          return null;
        },
        runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
          mutations.push(args);
          if (Array.isArray(args.images)) {
            return { published: true, cancelled: false };
          }
          return null;
        },
        storage: {
          get: async () => null,
          store: async () => `storage_${++storedCount}`,
          getUrl: async (storageId: string) => `https://files.example/${storageId}.png`,
        },
      } as never,
      args: {
        chatId: "chat_1",
        userId: "user_1",
        userMessageId: "message_user",
        assistantMessageIds: ["message_assistant"],
        generationJobIds: ["job_1"],
        participants: [],
        expandMultiModelGroups: false,
        webSearchEnabled: false,
        imageConfig: { aspectRatio: "1:1" },
      } as never,
      participant: {
        modelId: "openai/gpt-image-2",
        messageId: "message_assistant",
        jobId: "job_1",
      } as never,
      allMessages: [{
        _id: "message_user",
        role: "user",
        content: "Draw two cats",
      }],
      memoryContext: undefined,
      modelCapabilities: new Map([[
        "openai/gpt-image-2",
        {
          provider: "openai",
          supportedParameters: [],
          contextLength: 32_000,
          hasImageGeneration: true,
          imageCapabilities: {
            supportedParameters: {
              n: { min: 1, max: 4 },
              aspect_ratio: { values: ["1:1", "16:9"] },
            },
          },
        },
      ]]),
      isPro: true,
      runtimeProfile: "mobileBasic",
      apiKey: "test-key",
      actionStartTime: Date.now(),
      requestMessagesOverride: [{ role: "user", content: "Draw two cats" }],
    });

    assert.equal(result.failed, false);
    assert.equal(result.generationId, "generation_image");
    assert.equal(result.terminalAnalytics?.source, "image_generation");
    assert.equal(result.terminalAnalytics?.properties.modality, "image");
    assert.equal(result.terminalAnalytics?.properties.endpoint, "/api/v1/images");
    assert.equal(result.terminalAnalytics?.properties.requested_image_count, 2);
    assert.equal(result.terminalAnalytics?.properties.image_count, 2);
    assert.equal(result.terminalAnalytics?.properties.image_failed_count, 0);
    assert.equal(result.terminalAnalytics?.properties.image_partial_success, false);
    assert.ok(mutations.some((args) =>
      args.requestedCount === 2 && Array.isArray(args.images)
    ));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("image setup failures before the provider call retain image attribution", async () => {
  const scheduled: Array<Record<string, unknown>> = [];
  let jobQueryCount = 0;
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("modelId" in args) {
        return {
          hasImageGeneration: true,
          hasVideoGeneration: false,
          hasAudioOutput: false,
          imageCapabilities: {
            supportedParameters: { n: { min: 1, max: 4 } },
          },
        };
      }
      if ("jobId" in args) {
        jobQueryCount += 1;
        if (jobQueryCount === 1) return { status: "queued" };
        if (jobQueryCount === 2) return { status: "streaming" };
        return { status: "failed" };
      }
      if ("userId" in args) return null;
      return null;
    },
    runMutation: async () => undefined,
    scheduler: {
      runAfter: async (
        _delayMs: number,
        _fn: unknown,
        payload: Record<string, unknown>,
      ) => {
        scheduled.push(payload);
        return `scheduled_${scheduled.length}`;
      },
    },
  } as never;

  await assert.rejects(
    runGenerationParticipantHandler(ctx, {
      ...participantArgs(),
      imageConfig: { count: 3 },
      directToolNames: [],
      resumeExpected: false,
    } as never),
    /OpenRouter API key/,
  );

  const started = scheduled.find((payload) => payload.event === "assistant_response_started");
  const failed = scheduled.find((payload) => payload.event === "assistant_response_failed");
  for (const event of [started, failed]) {
    const properties = event?.properties as Record<string, unknown>;
    assert.equal(properties.source, "image_generation");
    assert.equal(properties.modality, "image");
    assert.equal(properties.endpoint, "/api/v1/images");
    assert.equal(properties.stream, false);
    assert.equal(properties.requested_image_count, 3);
  }
  assert.equal((failed?.properties as Record<string, unknown>).failure_category, "missing_api_key");
});
