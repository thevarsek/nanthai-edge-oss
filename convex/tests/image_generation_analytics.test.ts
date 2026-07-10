import assert from "node:assert/strict";
import test from "node:test";

import { captureAssistantResponseTerminal } from "../chat/generation_analytics";
import { dedicatedImageGenerationAnalytics } from "../chat/image_generation_analytics";
import type { RunGenerationParticipantArgs } from "../chat/generation_continuation_shared";

function analyticsContext() {
  const scheduled: Array<Record<string, unknown>> = [];
  return {
    scheduled,
    ctx: {
      scheduler: {
        runAfter: async (
          _delayMs: number,
          _fn: unknown,
          payload: Record<string, unknown>,
        ) => {
          scheduled.push(payload);
          return "scheduled_1";
        },
      },
    } as never,
  };
}

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

test("dedicated image analytics reports only effective capability-gated config", () => {
  const analytics = dedicatedImageGenerationAnalytics({
    config: {
      count: 9,
      aspectRatio: "16:9",
      resolution: "4K",
      quality: "high",
      background: "transparent",
      outputFormat: "jpeg",
      outputCompression: 85,
    },
    supportedParameters: {
      n: { min: 1, max: 4 },
      aspect_ratio: { values: ["1:1", "16:9"] },
      resolution: { values: ["1K", "2K"] },
      quality: { values: ["low", "medium"] },
      background: { values: ["opaque", "transparent"] },
      output_format: { values: ["png", "jpeg"] },
      output_compression: { min: 0, max: 100 },
    },
    generatedImageCount: 3,
    originSource: "chat_generation",
  });

  assert.equal(analytics.source, "image_generation");
  assert.deepEqual(analytics.properties, {
    modality: "image",
    endpoint: "/api/v1/images",
    stream: false,
    origin_source: "chat_generation",
    requested_image_count: 4,
    image_count: 3,
    image_failed_count: 1,
    image_partial_success: true,
    image_config_present: true,
    image_config_applied: true,
    image_config_count: 4,
    image_config_aspect_ratio: "16:9",
    image_config_resolution: "2K",
    image_config_size: null,
    image_config_quality: "medium",
    image_config_background: "transparent",
    image_config_output_format: "png",
    image_config_output_compression: null,
  });
});

test("dedicated image analytics does not report unsupported raw config as applied", () => {
  const analytics = dedicatedImageGenerationAnalytics({
    config: { count: 10, resolution: "4K", quality: "high" },
    supportedParameters: {},
  });

  assert.equal(analytics.properties.requested_image_count, 1);
  assert.equal(analytics.properties.image_count, null);
  assert.equal(analytics.properties.image_failed_count, null);
  assert.equal(analytics.properties.image_partial_success, null);
  assert.equal(analytics.properties.image_config_present, true);
  assert.equal(analytics.properties.image_config_applied, false);
  assert.equal(analytics.properties.image_config_count, null);
  assert.equal(analytics.properties.image_config_resolution, null);
  assert.equal(analytics.properties.image_config_quality, null);
});

test("model-default analytics uses the observed provider count for partial results", () => {
  const analytics = dedicatedImageGenerationAnalytics({
    supportedParameters: { n: { values: ["1", "4"] } },
    requestedImageCount: 2,
    generatedImageCount: 1,
  });

  assert.equal(analytics.properties.requested_image_count, 2);
  assert.equal(analytics.properties.image_count, 1);
  assert.equal(analytics.properties.image_failed_count, 1);
  assert.equal(analytics.properties.image_partial_success, true);
  assert.equal(analytics.properties.image_config_count, null);
});

test("image completions carry a dedicated source, endpoint, count, and config", async () => {
  const { ctx, scheduled } = analyticsContext();
  const terminalAnalytics = dedicatedImageGenerationAnalytics({
    config: { count: 2, aspectRatio: "1:1" },
    supportedParameters: {
      n: { min: 1, max: 4 },
      aspect_ratio: { values: ["1:1", "16:9"] },
    },
    generatedImageCount: 2,
    originSource: "chat_generation",
  });

  await captureAssistantResponseTerminal(ctx, participantArgs(), null, {
    continued: false,
    failed: false,
    cancelled: false,
    deferredForSubagents: false,
    generationId: "generation_1",
    terminalAnalytics,
  }, 250);

  const properties = scheduled[0]?.properties as Record<string, unknown>;
  assert.equal(scheduled[0]?.event, "assistant_response_completed");
  assert.equal(properties.source, "image_generation");
  assert.equal(properties.origin_source, "chat_generation");
  assert.equal(properties.modality, "image");
  assert.equal(properties.endpoint, "/api/v1/images");
  assert.equal(properties.requested_image_count, 2);
  assert.equal(properties.image_count, 2);
  assert.equal(properties.image_failed_count, 0);
  assert.equal(properties.image_partial_success, false);
  assert.equal(properties.image_config_aspect_ratio, "1:1");
});

test("image failures remain attributable before an image payload exists", async () => {
  const { ctx, scheduled } = analyticsContext();
  const terminalAnalytics = dedicatedImageGenerationAnalytics({
    config: { count: 3 },
    supportedParameters: { n: { min: 1, max: 4 } },
    originSource: "chat_generation",
  });

  await captureAssistantResponseTerminal(ctx, participantArgs(), null, {
    continued: false,
    failed: true,
    cancelled: false,
    deferredForSubagents: false,
    error: new Error("OpenRouter 404: No endpoint found for model"),
    terminalAnalytics,
  }, 125);

  const properties = scheduled[0]?.properties as Record<string, unknown>;
  assert.equal(scheduled[0]?.event, "assistant_response_failed");
  assert.equal(properties.source, "image_generation");
  assert.equal(properties.modality, "image");
  assert.equal(properties.endpoint, "/api/v1/images");
  assert.equal(properties.requested_image_count, 3);
  assert.equal(properties.image_count, null);
  assert.equal(properties.failure_category, "model_unavailable");
});
