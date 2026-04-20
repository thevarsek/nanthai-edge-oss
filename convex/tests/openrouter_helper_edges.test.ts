import assert from "node:assert/strict";
import test from "node:test";

import {
  extractFirstTextFromUnknown,
  extractImageUrlsFromUnknown,
  extractTextAndImages,
  usageFromUnknown,
} from "../lib/openrouter_extract";
import { gateParameters } from "../lib/openrouter_gate";
import {
  normalizeUnsupportedParameterName,
  parseUnsupportedParameter,
  stripParameter,
} from "../lib/openrouter_param_retry";
import { buildRequestBody } from "../lib/openrouter_request";

test("parseUnsupportedParameter reads nested payloads and stripParameter clears supported fields", () => {
  const param = parseUnsupportedParameter({
    error: {
      details: "Unknown name reasoning_effort",
    },
  });

  assert.equal(param, "reasoning");
  assert.equal(normalizeUnsupportedParameterName("max_completion_tokens"), "max_tokens");

  const stripped = stripParameter("web_search", {
    webSearchEnabled: true,
    maxTokens: 200,
    reasoningEffort: "high",
  });
  assert.deepEqual(stripped, {
    webSearchEnabled: false,
    maxTokens: 200,
    reasoningEffort: "high",
  });
});

test("gateParameters applies image-generation and reasoning support rules", () => {
  const gatedImage = gateParameters(
    {
      temperature: 0.7,
      includeReasoning: true,
      reasoningEffort: "high",
      modalities: ["text"],
      imageConfig: { aspectRatio: "1:1" },
    },
    ["max_tokens"],
    true,
    false,
  );
  const gatedReasoningFallback = gateParameters(
    {
      includeReasoning: true,
      reasoningEffort: "medium",
      temperature: 0.4,
    },
    undefined,
    false,
    false,
  );

  assert.deepEqual(gatedImage.modalities, ["image"]);
  assert.equal(gatedImage.temperature, null);
  assert.equal(gatedImage.includeReasoning, null);
  assert.equal(gatedReasoningFallback.includeReasoning, false);
  assert.equal(gatedReasoningFallback.reasoningEffort, null);
});

test("gateParameters strips tools and toolChoice but keeps webSearchEnabled when model lacks tool support", () => {
  // Model that does NOT support tools (e.g. ERNIE) — tools/toolChoice stripped,
  // webSearchEnabled preserved so buildRequestBody can fall back to plugin API.
  const gated = gateParameters(
    {
      temperature: 0.7,
      webSearchEnabled: true,
      tools: [{ type: "function", function: { name: "test", description: "test", parameters: {} } }],
      toolChoice: "auto",
    },
    ["temperature", "max_tokens"],  // no "tools" in supportedParameters
    false,
    false,
  );
  assert.equal(gated.webSearchEnabled, true);  // kept for plugin fallback
  assert.equal(gated.tools, null);
  assert.equal(gated.toolChoice, null);
  assert.equal(gated.temperature, 0.7);  // other params unaffected

  // Model that DOES support tools — everything passes through
  const gatedWithTools = gateParameters(
    {
      temperature: 0.7,
      webSearchEnabled: true,
      tools: [{ type: "function", function: { name: "test", description: "test", parameters: {} } }],
      toolChoice: "auto",
    },
    ["temperature", "max_tokens", "tools"],
    false,
    false,
  );
  assert.equal(gatedWithTools.webSearchEnabled, true);
  assert.deepEqual(gatedWithTools.tools?.length, 1);
  assert.equal(gatedWithTools.toolChoice, "auto");
});

test("OpenRouter extract helpers recover text, images, and usage from heterogeneous payloads", () => {
  const content = extractTextAndImages([
    { type: "text", text: "Hello " },
    { type: "output_text", text: "world" },
    { type: "image", base64: "A".repeat(80) },
    { image_url: { url: "https://example.com/image.png" } },
  ]);
  const images = extractImageUrlsFromUnknown({
    image_url: { url: "https://example.com/one.png" },
    image: "B".repeat(80),
  });
  const text = extractFirstTextFromUnknown({
    output: [{ type: "text", text: "Primary text" }],
  });
  const usage = usageFromUnknown({
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15,
    cost: 0.12,
    prompt_tokens_details: { cached_tokens: 3 },
    completion_tokens_details: { reasoning_tokens: 2 },
  });

  assert.equal(content.text, "Hello world");
  assert.equal(content.imageUrls.length, 2);
  assert.equal(images.length, 2);
  assert.equal(text, "Primary text");
  assert.deepEqual(usage, {
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    cost: 0.12,
    cachedTokens: 3,
    reasoningTokens: 2,
  });

  const usageWithServerTools = usageFromUnknown({
    prompt_tokens: 20,
    completion_tokens: 8,
    total_tokens: 28,
    cost: 0.25,
    server_tool_use: { web_search_requests: 3 },
  });
  assert.deepEqual(usageWithServerTools, {
    promptTokens: 20,
    completionTokens: 8,
    totalTokens: 28,
    cost: 0.25,
    webSearchRequests: 3,
  });

  const usageWithZeroSearches = usageFromUnknown({
    prompt_tokens: 5,
    completion_tokens: 2,
    total_tokens: 7,
    server_tool_use: { web_search_requests: 0 },
  });
  assert.equal(usageWithZeroSearches?.webSearchRequests, undefined);
});

test("buildRequestBody uses server tool for web search when model has tools, plugin fallback otherwise", () => {
  const messages = [{ role: "user" as const, content: "hello" }];
  const dummyTool = {
    type: "function" as const,
    function: { name: "test", description: "test", parameters: {} },
  };

  // === Model WITH tool support (function tools present) ===

  // toolChoice "auto" + function tools — web search injected as server tool
  const bodyWithTools = buildRequestBody("openai/gpt-5.4", messages, {
    webSearchEnabled: true,
    toolChoice: "auto",
    tools: [dummyTool],
  }, true);
  const toolsWithTools = bodyWithTools.tools as unknown[];
  assert.equal(toolsWithTools.length, 2);  // function tool + server tool
  assert.deepEqual((toolsWithTools[0] as any).type, "function");
  assert.deepEqual((toolsWithTools[1] as any).type, "openrouter:web_search");
  assert.equal(bodyWithTools.plugins, undefined);  // no plugin fallback

  // toolChoice "none" + function tools — server tool suppressed (forced text)
  const bodyNone = buildRequestBody("openai/gpt-5.4", messages, {
    webSearchEnabled: true,
    toolChoice: "none",
    tools: [dummyTool],
  }, true);
  const toolsNone = bodyNone.tools as unknown[];
  assert.equal(toolsNone.length, 1);  // only function tool, no server tool
  assert.deepEqual((toolsNone[0] as any).type, "function");
  assert.equal(bodyNone.plugins, undefined);

  // === Tool-capable model, web search, NO function tools ===
  // tools is `undefined` (not set) — model supports tools but no integrations
  // are active. Server tool is still safe to inject (not plugin fallback).
  const bodyNoFuncTools = buildRequestBody("openai/gpt-5.4", messages, {
    webSearchEnabled: true,
    // tools is undefined — no integrations, but model CAN accept tools
  }, true);
  const toolsNoFunc = bodyNoFuncTools.tools as unknown[];
  assert.equal(toolsNoFunc.length, 1);  // only the server tool
  assert.deepEqual((toolsNoFunc[0] as any).type, "openrouter:web_search");
  assert.equal(bodyNoFuncTools.plugins, undefined);  // no plugin fallback

  // === Model WITHOUT tool support (tools explicitly stripped by gateParameters) ===

  // gateParameters sets tools = null for non-tool models → plugin fallback
  const bodyNoTools = buildRequestBody("baidu/ernie-4.5-300b-a47b", messages, {
    webSearchEnabled: true,
    tools: null as any,  // gateParameters explicitly strips to null
  }, false);
  assert.equal(bodyNoTools.tools, undefined);  // no tools array on the wire
  assert.deepEqual(bodyNoTools.plugins, [{ id: "web" }]);

  // webSearchEnabled false + tools stripped → no plugin either
  const bodyNoSearch = buildRequestBody("baidu/ernie-4.5-300b-a47b", messages, {
    webSearchEnabled: false,
    tools: null as any,
  }, false);
  assert.equal(bodyNoSearch.tools, undefined);
  assert.equal(bodyNoSearch.plugins, undefined);

  // === Edge case: webSearchEnabled + function tools but toolChoice unset ===
  const bodyAutoDefault = buildRequestBody("openai/gpt-5.4", messages, {
    webSearchEnabled: true,
    tools: [dummyTool],
  }, true);
  const toolsAutoDefault = bodyAutoDefault.tools as unknown[];
  assert.equal(toolsAutoDefault.length, 2);
  assert.deepEqual((toolsAutoDefault[1] as any).type, "openrouter:web_search");

  // === Edge case: webSearchMaxTotalResults custom budget ===
  const bodyCustomBudget = buildRequestBody("openai/gpt-5.4", messages, {
    webSearchEnabled: true,
    webSearchMaxTotalResults: 5,  // subagent budget
  }, true);
  const toolsCustom = bodyCustomBudget.tools as unknown[];
  assert.equal(toolsCustom.length, 1);
  assert.deepEqual((toolsCustom[0] as any).type, "openrouter:web_search");
  assert.equal((toolsCustom[0] as any).parameters.max_total_results, 5);
  assert.equal((toolsCustom[0] as any).parameters.max_results, 5);
});

// ---------------------------------------------------------------------------
// REGRESSION: Legacy plugin fallback for non-tool models.
//
// ~58 eligible models (out of 269 in our catalog) don't support tools —
// ERNIE, Gemma 3, Cohere Command, Hermes, Llama 3.1 405B, Nemotron Ultra,
// plus 5 Perplexity (native search), 5 image/audio, 2 guard, 2 routers,
// and 2 OpenAI search-preview models. OpenRouter rejects the `tools` param
// entirely for these models (404). The legacy plugin API
// (`plugins: [{id: "web"}]`) is the only way to get web search on them —
// confirmed via live probe against baidu/ernie-4.5-300b-a47b
// (server tool = 404, plugin = 200).
//
// OpenRouter has deprecated the plugin API in favour of server tools, but
// has not yet provided a migration path for models that can't accept tools.
// Until they do, this fallback MUST remain. If you remove it, this test
// will fail and remind you to check whether OpenRouter has solved this.
//
// Tracking:
//   Plugin deprecation notice:
//     https://openrouter.ai/docs/guides/features/plugins/web-search
//   Server tool docs:
//     https://openrouter.ai/docs/guides/features/server-tools/web-search
// ---------------------------------------------------------------------------
test("REGRESSION: plugin fallback produces {id:'web'} for non-tool models and never emits a tools array", () => {
  const messages = [{ role: "user" as const, content: "hello" }];

  // Simulate what gateParameters produces for a non-tool model: tools = null.
  const body = buildRequestBody("baidu/ernie-4.5-300b-a47b", messages, {
    webSearchEnabled: true,
    tools: null as any,
  }, false);

  // The wire body must NOT contain a `tools` key — OpenRouter returns 404 if
  // it does for models without tool support.
  assert.equal(body.tools, undefined, "tools array must be absent for non-tool models");

  // The wire body MUST contain the legacy plugin.
  assert.ok(body.plugins, "plugins must be present as fallback");
  assert.deepEqual(body.plugins, [{ id: "web" }]);

  // Verify the full gateParameters → buildRequestBody pipeline end-to-end.
  const gated = gateParameters(
    {
      temperature: 0.7,
      webSearchEnabled: true,
      tools: [{ type: "function", function: { name: "f", description: "f", parameters: {} } }],
      toolChoice: "auto",
    },
    ["temperature", "max_tokens"],  // no "tools" → model lacks tool support
    false,
    false,
  );

  // gateParameters must strip tools to null and keep webSearchEnabled.
  assert.equal(gated.tools, null, "gateParameters must set tools to null for non-tool models");
  assert.equal(gated.webSearchEnabled, true, "gateParameters must preserve webSearchEnabled");

  const bodyE2E = buildRequestBody("baidu/ernie-4.5-300b-a47b", messages, gated, false);
  assert.equal(bodyE2E.tools, undefined, "end-to-end: no tools on wire");
  assert.deepEqual(bodyE2E.plugins, [{ id: "web" }], "end-to-end: plugin fallback present");
});

// Phase 2.9: provider-sort defaults
test("buildRequestBody attaches default provider-sort when caller supplies no provider", () => {
  const messages = [{ role: "user" as const, content: "hi" }];
  const body = buildRequestBody("openai/gpt-5", messages, {}, false);
  assert.deepEqual(
    body.provider,
    { sort: "latency" },
    "provider-sort default must attach when caller omits provider block",
  );
});

test("buildRequestBody merges caller-supplied ZDR with provider-sort defaults", () => {
  const messages = [{ role: "user" as const, content: "hi" }];
  const body = buildRequestBody(
    "google/gemini-2.5-pro",
    messages,
    { provider: { zdr: true } },
    false,
  );
  assert.deepEqual(
    body.provider,
    { sort: "latency", zdr: true },
    "ZDR must be preserved and provider-sort defaults must merge in",
  );
});

test("buildRequestBody lets caller-supplied provider.sort override the default", () => {
  const messages = [{ role: "user" as const, content: "hi" }];
  const body = buildRequestBody(
    "openai/gpt-5",
    messages,
    {
      provider: {
        sort: "throughput",
        preferred_max_latency: { p90: 10 },
      },
    },
    false,
  );
  assert.deepEqual(
    body.provider,
    { sort: "throughput", preferred_max_latency: { p90: 10 } },
    "caller-supplied sort/preferred_max_latency must win over defaults",
  );
});
