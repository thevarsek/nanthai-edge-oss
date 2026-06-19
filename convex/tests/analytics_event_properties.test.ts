import assert from "node:assert/strict";
import test from "node:test";

import { analyticsClientProperties } from "../analytics/client_metadata";
import {
  openRouterFailureCategory,
  openRouterUsageAnalyticsProperties,
} from "../analytics/event_properties";
import {
  getAnalyticsIdentity,
} from "../analytics/identity";
import { deriveAnalyticsIdForClerkUserId } from "../analytics/analytics_id";
import { captureBackendAnalytics } from "../analytics/posthog";
import { assistantResponseFailureDetails } from "../chat/generation_analytics";
import { markGenerationJobAnalyticsStarted } from "../chat/mutations";
import { markRunAnalyticsStarted } from "../subagents/mutations";

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

test("openRouterUsageAnalyticsProperties maps sanitized aggregate usage fields", () => {
  assert.deepEqual(openRouterUsageAnalyticsProperties({
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    cost: 0.001,
    upstreamInferenceCost: 0.0008,
    upstreamInferencePromptCost: 0.0003,
    upstreamInferenceCompletionsCost: 0.0005,
    isByok: true,
    cachedTokens: 3,
    cacheWriteTokens: 2,
    reasoningTokens: 4,
    audioPromptTokens: 6,
    audioCompletionTokens: 7,
    imageCompletionTokens: 8,
    videoTokens: 9,
    webSearchRequests: 1,
    cacheDiscount: -0.0001,
  }), {
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15,
    cost_usd: 0.001,
    upstream_cost_usd: 0.0008,
    is_byok: true,
    cached_tokens: 3,
    cache_write_tokens: 2,
    reasoning_tokens: 4,
    audio_prompt_tokens: 6,
    audio_completion_tokens: 7,
    image_tokens: 8,
    video_tokens: 9,
    web_search_requests: 1,
    cache_discount_usd: -0.0001,
    upstream_prompt_cost_usd: 0.0003,
    upstream_completion_cost_usd: 0.0005,
  });
});

test("analyticsClientProperties exposes app version aliases for backend events", () => {
  assert.deepEqual(analyticsClientProperties({
    platform: "ios",
    appVersion: "1.2.3",
    buildNumber: "456",
    surface: "ios_app",
    routeOrScreen: "chat",
    clientEventId: "event-1",
    clientSentAt: 123,
  }), {
    client_platform: "ios",
    app_version: "1.2.3",
    build_number: "456",
    client_app_version: "1.2.3",
    client_build_number: "456",
    client_surface: "ios_app",
    client_route_or_screen: "chat",
    client_event_id: "event-1",
    client_sent_at: 123,
  });
});

test("openRouterFailureCategory maps stable provider/setup buckets", () => {
  assert.equal(
    openRouterFailureCategory(new Error('ConvexError: {"code":"MISSING_API_KEY"}')),
    "missing_api_key",
  );
  assert.equal(
    openRouterFailureCategory(new Error("OpenRouter 401 unauthorized invalid API key")),
    "invalid_api_key",
  );
  assert.equal(
    openRouterFailureCategory(new Error("OpenRouter 402 insufficient credits")),
    "insufficient_credits",
  );
  assert.equal(
    openRouterFailureCategory(new Error('ConvexError: {"code":"ZDR_MODEL_UNAVAILABLE"}')),
    "model_unavailable",
  );
  assert.equal(
    openRouterFailureCategory(new Error("429 too many requests")),
    "rate_limited",
  );
  assert.equal(
    openRouterFailureCategory(new Error("maximum context length exceeded")),
    "context_length_exceeded",
  );
  assert.equal(
    openRouterFailureCategory(new Error("stream timeout")),
    "timeout",
  );
  assert.equal(
    openRouterFailureCategory(new Error("upstream provider returned 503")),
    "provider_error",
  );
});

test("assistantResponseFailureDetails preserves stable failure categories", () => {
  assert.deepEqual(
    assistantResponseFailureDetails({
      cancelled: false,
      error: new Error("OpenRouter 402 insufficient credits"),
    }),
    {
      failure_category: "insufficient_credits",
      error_type: "generation_failed",
      error_label: "error",
    },
  );

  assert.deepEqual(
    assistantResponseFailureDetails({
      cancelled: true,
    }),
    {
      failure_category: "cancelled",
      cancellation_category: "unknown_cancelled",
      error_type: "cancelled",
      error_label: "cancelled",
    },
  );

  assert.deepEqual(
    assistantResponseFailureDetails({
      cancelled: true,
      properties: { terminal_error_code: "cancelled_by_retry" },
      source: "chat_generation",
    }),
    {
      failure_category: "cancelled",
      cancellation_category: "cancelled_by_retry",
      error_type: "cancelled",
      error_label: "cancelled",
    },
  );

  assert.deepEqual(
    assistantResponseFailureDetails({
      cancelled: true,
      properties: { terminal_error_code: "cancelled_by_user" },
      source: "web_search",
    }),
    {
      failure_category: "cancelled",
      cancellation_category: "cancelled_by_user",
      error_type: "cancelled",
      error_label: "cancelled",
    },
  );

  assert.deepEqual(
    assistantResponseFailureDetails({
      cancelled: true,
      properties: { setup_phase: "cancelled_before_start" },
      source: "chat_generation",
    }),
    {
      failure_category: "cancelled",
      cancellation_category: "cancelled_before_start",
      error_type: "cancelled",
      error_label: "cancelled",
    },
  );
});

test("deriveAnalyticsIdForClerkUserId uses a stable HMAC and omits raw identity", async () => {
  const originalSecret = process.env.ANALYTICS_ID_SECRET;
  process.env.ANALYTICS_ID_SECRET = "analytics-test-secret";

  try {
    const first = await deriveAnalyticsIdForClerkUserId("user_1");
    const second = await deriveAnalyticsIdForClerkUserId("user_1");
    const other = await deriveAnalyticsIdForClerkUserId("user_2");

    assert.equal(first, second);
    assert.notEqual(first, other);
    assert.match(first ?? "", /^aid_[A-Za-z0-9_-]+$/);
    assert.ok(!(first ?? "").includes("user_1"));
  } finally {
    if (originalSecret === undefined) {
      delete process.env.ANALYTICS_ID_SECRET;
    } else {
      process.env.ANALYTICS_ID_SECRET = originalSecret;
    }
  }
});

test("deriveAnalyticsIdForClerkUserId returns null when the secret is missing", async () => {
  const originalSecret = process.env.ANALYTICS_ID_SECRET;
  delete process.env.ANALYTICS_ID_SECRET;

  try {
    assert.equal(await deriveAnalyticsIdForClerkUserId("user_1"), null);
  } finally {
    if (originalSecret === undefined) {
      delete process.env.ANALYTICS_ID_SECRET;
    } else {
      process.env.ANALYTICS_ID_SECRET = originalSecret;
    }
  }
});

test("getAnalyticsIdentity returns only pseudonymous analytics ID", async () => {
  const originalSecret = process.env.ANALYTICS_ID_SECRET;
  process.env.ANALYTICS_ID_SECRET = "analytics-test-secret";

  try {
    const result = await (getAnalyticsIdentity as any)._handler({
      auth: {
        getUserIdentity: async () => ({
          subject: "user_1",
          email: "ada@example.com",
          name: "Ada Lovelace",
        }),
      },
    }, {});

    assert.ok(result);
    assert.equal(result?.analyticsId, await deriveAnalyticsIdForClerkUserId("user_1"));
    assert.ok(!("clerkUserId" in result));
    assert.ok(!JSON.stringify(result).includes("user_1"));
    assert.ok(!JSON.stringify(result).includes("ada@example.com"));
    assert.ok(!JSON.stringify(result).includes("Ada Lovelace"));

    const mismatched = await (getAnalyticsIdentity as any)._handler({
      auth: {
        getUserIdentity: async () => ({
          subject: "user_1",
          email: "ada@example.com",
          name: "Ada Lovelace",
        }),
      },
    }, { clerkUserId: "user_2" });
    assert.equal(mismatched, null);
  } finally {
    if (originalSecret === undefined) {
      delete process.env.ANALYTICS_ID_SECRET;
    } else {
      process.env.ANALYTICS_ID_SECRET = originalSecret;
    }
  }
});

test("analytics start markers only return true for the first nonterminal mark", async () => {
  const jobPatches: Array<Record<string, unknown>> = [];
  const firstJobMark = await (markGenerationJobAnalyticsStarted as any)._handler({
    db: {
      get: async () => ({ _id: "job_1", status: "streaming" }),
      patch: async (_id: string, patch: Record<string, unknown>) => {
        jobPatches.push(patch);
      },
    },
  }, { jobId: "job_1" });
  const duplicateJobMark = await (markGenerationJobAnalyticsStarted as any)._handler({
    db: {
      get: async () => ({ _id: "job_1", status: "streaming", analyticsStartedAt: 123 }),
      patch: async (_id: string, patch: Record<string, unknown>) => {
        jobPatches.push(patch);
      },
    },
  }, { jobId: "job_1" });
  const terminalJobMark = await (markGenerationJobAnalyticsStarted as any)._handler({
    db: {
      get: async () => ({ _id: "job_1", status: "completed" }),
      patch: async (_id: string, patch: Record<string, unknown>) => {
        jobPatches.push(patch);
      },
    },
  }, { jobId: "job_1" });

  assert.equal(firstJobMark, true);
  assert.equal(duplicateJobMark, false);
  assert.equal(terminalJobMark, false);
  assert.equal(jobPatches.length, 1);

  const runPatches: Array<Record<string, unknown>> = [];
  const firstRunMark = await (markRunAnalyticsStarted as any)._handler({
    db: {
      get: async () => ({ _id: "run_1", status: "streaming" }),
      patch: async (_id: string, patch: Record<string, unknown>) => {
        runPatches.push(patch);
      },
    },
  }, { runId: "run_1" });
  const duplicateRunMark = await (markRunAnalyticsStarted as any)._handler({
    db: {
      get: async () => ({ _id: "run_1", status: "streaming", analyticsStartedAt: 123 }),
      patch: async (_id: string, patch: Record<string, unknown>) => {
        runPatches.push(patch);
      },
    },
  }, { runId: "run_1" });

  assert.equal(firstRunMark, true);
  assert.equal(duplicateRunMark, false);
  assert.equal(runPatches.length, 1);
});

test("captureBackendAnalytics no-ops when analytics ID secret is missing", async () => {
  const originalFetch = globalThis.fetch;
  const originalProjectToken = process.env.POSTHOG_PROJECT_TOKEN;
  const originalSecret = process.env.ANALYTICS_ID_SECRET;
  const fetchCalls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ input, init });
    return new Response(JSON.stringify({ status: "Ok" }), { status: 200 });
  }) as typeof fetch;
  process.env.POSTHOG_PROJECT_TOKEN = "phc_test_project_token";
  delete process.env.ANALYTICS_ID_SECRET;

  try {
    await captureBackendAnalytics("user_1", "assistant_response_started", {
      chat_id: "chat_1",
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalProjectToken === undefined) {
      delete process.env.POSTHOG_PROJECT_TOKEN;
    } else {
      process.env.POSTHOG_PROJECT_TOKEN = originalProjectToken;
    }
    if (originalSecret === undefined) {
      delete process.env.ANALYTICS_ID_SECRET;
    } else {
      process.env.ANALYTICS_ID_SECRET = originalSecret;
    }
  }

  assert.equal(fetchCalls.length, 0);
});

test("captureBackendAnalytics posts to the public PostHog ingestion endpoint", async () => {
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
  process.env.POSTHOG_HOST = "https://eu.i.posthog.com/";
  process.env.ANALYTICS_ID_SECRET = "analytics-test-secret";

  try {
    expectedAnalyticsId = await deriveAnalyticsIdForClerkUserId("user_1");
    await captureBackendAnalytics("user_1", "assistant_response_started", {
      chat_id: "chat_1",
      email: "ada@example.com",
      name: "Ada Lovelace",
      userId: "user_1",
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.POSTHOG_PROJECT_API_KEY;
    } else {
      process.env.POSTHOG_PROJECT_API_KEY = originalApiKey;
    }
    if (originalProjectToken === undefined) {
      delete process.env.POSTHOG_PROJECT_TOKEN;
    } else {
      process.env.POSTHOG_PROJECT_TOKEN = originalProjectToken;
    }
    if (originalHost === undefined) {
      delete process.env.POSTHOG_HOST;
    } else {
      process.env.POSTHOG_HOST = originalHost;
    }
    if (originalSecret === undefined) {
      delete process.env.ANALYTICS_ID_SECRET;
    } else {
      process.env.ANALYTICS_ID_SECRET = originalSecret;
    }
  }

  assert.equal(fetchCalls.length, 1);
  const call = fetchCalls[0];
  assert.ok(call);
  assert.equal(String(call.input), "https://eu.i.posthog.com/i/v0/e/");
  assert.equal(call.init?.method, "POST");
  const payload = JSON.parse(String(call.init?.body)) as CapturedPostHogPayload;
  assert.equal(payload.api_key, "phc_test_project_token");
  assert.equal(payload.event, "assistant_response_started");
  assert.equal(payload.distinct_id, expectedAnalyticsId);
  assert.notEqual(payload.distinct_id, "user_1");
  assert.deepEqual(payload.properties, {
    platform: "convex",
    app_surface: "backend",
    surface: "backend",
    chat_id: "chat_1",
  });
  const serializedPayload = JSON.stringify(payload);
  assert.ok(!serializedPayload.includes("user_1"));
  assert.ok(!serializedPayload.includes("ada@example.com"));
  assert.ok(!serializedPayload.includes("Ada Lovelace"));
});
