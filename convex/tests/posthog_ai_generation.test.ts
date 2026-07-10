import assert from "node:assert/strict";
import test from "node:test";

import { deriveAnalyticsIdForClerkUserId } from "../analytics/analytics_id";
import { captureBackendAnalytics } from "../analytics/posthog";

type FetchCall = {
  input: RequestInfo | URL;
  init?: RequestInit;
};

type CapturedPostHogPayload = {
  api_key: string;
  event: string;
  distinct_id: string;
  properties: Record<string, unknown>;
};

test("captureBackendAnalytics mirrors assistant completions as sanitized ai generation events", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.POSTHOG_PROJECT_API_KEY;
  const originalProjectToken = process.env.POSTHOG_PROJECT_TOKEN;
  const originalHost = process.env.POSTHOG_HOST;
  const originalSecret = process.env.ANALYTICS_ID_SECRET;
  const fetchCalls: FetchCall[] = [];
  let expectedAnalyticsId: string | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ input, init });
    return new Response(JSON.stringify({ status: "Ok" }), { status: 200 });
  }) as typeof fetch;
  delete process.env.POSTHOG_PROJECT_API_KEY;
  process.env.POSTHOG_PROJECT_TOKEN = "phc_test_project_token";
  process.env.POSTHOG_HOST = "https://eu.i.posthog.com";
  process.env.ANALYTICS_ID_SECRET = "analytics-test-secret";

  try {
    expectedAnalyticsId = await deriveAnalyticsIdForClerkUserId("user_1");
    await captureBackendAnalytics("user_1", "assistant_response_completed", {
      chat_id: "chat_1",
      message_id: "msg_1",
      job_id: "job_1",
      model_id: "openai/gpt-5-mini",
      source: "chat_generation",
      openrouter_generation_id: "gen_1",
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      cost_usd: 0.0123,
      upstream_cost_usd: 0.01,
      duration_ms: 2000,
      ttft_ms: 350,
      openrouter_round_trip_duration_ms: 1800,
      tool_round_count: 1,
      tool_call_count: 2,
      client_platform: "web",
      client_surface: "web_app",
      email: "ada@example.com",
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("POSTHOG_PROJECT_API_KEY", originalApiKey);
    restoreEnv("POSTHOG_PROJECT_TOKEN", originalProjectToken);
    restoreEnv("POSTHOG_HOST", originalHost);
    restoreEnv("ANALYTICS_ID_SECRET", originalSecret);
  }

  assert.equal(fetchCalls.length, 2);
  const customPayload = JSON.parse(String(fetchCalls[0]?.init?.body)) as CapturedPostHogPayload;
  const aiPayload = JSON.parse(String(fetchCalls[1]?.init?.body)) as CapturedPostHogPayload;

  assert.equal(customPayload.event, "assistant_response_completed");
  assert.equal(aiPayload.event, "$ai_generation");
  assert.equal(aiPayload.distinct_id, expectedAnalyticsId);
  assert.deepEqual(aiPayload.properties, {
    platform: "convex",
    app_surface: "backend",
    surface: "backend",
    "$ai_trace_id": "chat_1",
    "$ai_session_id": "chat_1",
    "$ai_span_id": "gen_1",
    "$ai_span_name": "chat_generation",
    "$ai_model": "openai/gpt-5-mini",
    "$ai_provider": "openrouter",
    "$ai_input_tokens": 100,
    "$ai_output_tokens": 50,
    "$ai_total_cost_usd": 0.0123,
    "$ai_latency": 2,
    "$ai_time_to_first_token": 0.35,
    "$ai_stream": true,
    "$ai_is_error": false,
    chat_id: "chat_1",
    message_id: "msg_1",
    job_id: "job_1",
    openrouter_generation_id: "gen_1",
    source: "chat_generation",
    client_platform: "web",
    client_surface: "web_app",
    total_tokens: 150,
    upstream_cost_usd: 0.01,
    openrouter_round_trip_duration_ms: 1800,
    tool_round_count: 1,
    tool_call_count: 2,
  });

  const serializedPayloads = JSON.stringify([customPayload, aiPayload]);
  assert.ok(!serializedPayloads.includes("user_1"));
  assert.ok(!serializedPayloads.includes("ada@example.com"));
  assert.ok(!Object.hasOwn(aiPayload.properties, "$ai_input"));
  assert.ok(!Object.hasOwn(aiPayload.properties, "$ai_output_choices"));
});

test("ai generation mirrors dedicated image metadata and preserves stream defaults", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.POSTHOG_PROJECT_API_KEY;
  const originalProjectToken = process.env.POSTHOG_PROJECT_TOKEN;
  const originalHost = process.env.POSTHOG_HOST;
  const originalSecret = process.env.ANALYTICS_ID_SECRET;
  const fetchCalls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ input, init });
    return new Response(JSON.stringify({ status: "Ok" }), { status: 200 });
  }) as typeof fetch;
  delete process.env.POSTHOG_PROJECT_API_KEY;
  process.env.POSTHOG_PROJECT_TOKEN = "phc_test_project_token";
  process.env.POSTHOG_HOST = "https://eu.i.posthog.com";
  process.env.ANALYTICS_ID_SECRET = "analytics-test-secret";

  try {
    await captureBackendAnalytics("user_1", "assistant_response_completed", {
      chat_id: "chat_image",
      message_id: "message_image",
      job_id: "job_image",
      model_id: "openai/gpt-image-2",
      source: "image_generation",
      origin_source: "chat_generation",
      modality: "image",
      endpoint: "/api/v1/images",
      stream: false,
      requested_image_count: 2,
      image_count: 1,
      image_failed_count: 1,
      image_partial_success: true,
      image_config_present: true,
      image_config_applied: true,
      image_config_count: 2,
      image_config_aspect_ratio: "1:1",
      image_config_resolution: "2K",
      image_config_quality: "high",
      image_config_background: "opaque",
      image_config_output_format: "webp",
      image_config_output_compression: 80,
    });
    await captureBackendAnalytics("user_1", "assistant_response_completed", {
      chat_id: "chat_video",
      message_id: "message_video",
      job_id: "job_video",
      model_id: "google/veo-3",
      source: "video_generation",
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("POSTHOG_PROJECT_API_KEY", originalApiKey);
    restoreEnv("POSTHOG_PROJECT_TOKEN", originalProjectToken);
    restoreEnv("POSTHOG_HOST", originalHost);
    restoreEnv("ANALYTICS_ID_SECRET", originalSecret);
  }

  assert.equal(fetchCalls.length, 4);
  const imagePayload = JSON.parse(
    String(fetchCalls[1]?.init?.body),
  ) as CapturedPostHogPayload;
  const videoPayload = JSON.parse(
    String(fetchCalls[3]?.init?.body),
  ) as CapturedPostHogPayload;

  assert.equal(imagePayload.event, "$ai_generation");
  assert.equal(imagePayload.properties.$ai_stream, false);
  assert.equal(imagePayload.properties.source, "image_generation");
  assert.equal(imagePayload.properties.origin_source, "chat_generation");
  assert.equal(imagePayload.properties.modality, "image");
  assert.equal(imagePayload.properties.endpoint, "/api/v1/images");
  assert.equal(imagePayload.properties.requested_image_count, 2);
  assert.equal(imagePayload.properties.image_count, 1);
  assert.equal(imagePayload.properties.image_failed_count, 1);
  assert.equal(imagePayload.properties.image_partial_success, true);
  assert.equal(imagePayload.properties.image_config_count, 2);
  assert.equal(imagePayload.properties.image_config_aspect_ratio, "1:1");
  assert.equal(imagePayload.properties.image_config_resolution, "2K");
  assert.equal(imagePayload.properties.image_config_output_format, "webp");
  assert.equal(imagePayload.properties.image_config_output_compression, 80);

  assert.equal(videoPayload.event, "$ai_generation");
  assert.equal(videoPayload.properties.$ai_stream, true);
  assert.equal(videoPayload.properties.source, "video_generation");
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
