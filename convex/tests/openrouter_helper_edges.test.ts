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

test("buildRequestBody emits plugins:[{id:'web',max_results:5}] for web search on every model", () => {
  const messages = [{ role: "user" as const, content: "hello" }];
  const dummyTool = {
    type: "function" as const,
    function: { name: "test", description: "test", parameters: {} },
  };

  // === Model WITH tool support (function tools present) ===
  // Function tools are still emitted; web search goes to `plugins` regardless.
  const bodyWithTools = buildRequestBody("openai/gpt-5.5", messages, {
    webSearchEnabled: true,
    toolChoice: "auto",
    tools: [dummyTool],
  }, true);
  const toolsWithTools = bodyWithTools.tools as unknown[];
  assert.equal(toolsWithTools.length, 1, "only the function tool on .tools");
  assert.deepEqual((toolsWithTools[0] as any).type, "function");
  assert.deepEqual(bodyWithTools.plugins, [{ id: "web", max_results: 5 }]);
  assert.equal(bodyWithTools.tool_choice, "auto");

  // toolChoice "none" — plugin still attaches (plugin doesn't interact with
  // tool_choice, and web search intent is independent of whether the model
  // is allowed to call function tools this round).
  const bodyNone = buildRequestBody("openai/gpt-5.5", messages, {
    webSearchEnabled: true,
    toolChoice: "none",
    tools: [dummyTool],
  }, true);
  assert.deepEqual(bodyNone.plugins, [{ id: "web", max_results: 5 }]);
  assert.equal(bodyNone.tool_choice, "none");

  // === Tool-capable model, web search, NO function tools ===
  const bodyNoFuncTools = buildRequestBody("openai/gpt-5.5", messages, {
    webSearchEnabled: true,
  }, true);
  assert.equal(bodyNoFuncTools.tools, undefined, "no tools when no function tools");
  assert.deepEqual(bodyNoFuncTools.plugins, [{ id: "web", max_results: 5 }]);

  // === Model WITHOUT tool support (tools stripped to null by gateParameters) ===
  const bodyNoTools = buildRequestBody("baidu/ernie-4.5-300b-a47b", messages, {
    webSearchEnabled: true,
    tools: null as any,
  }, false);
  assert.equal(bodyNoTools.tools, undefined);
  assert.deepEqual(bodyNoTools.plugins, [{ id: "web", max_results: 5 }]);

  // === webSearchEnabled false → no plugin, no tools ===
  const bodyNoSearch = buildRequestBody("baidu/ernie-4.5-300b-a47b", messages, {
    webSearchEnabled: false,
    tools: null as any,
  }, false);
  assert.equal(bodyNoSearch.tools, undefined);
  assert.equal(bodyNoSearch.plugins, undefined);

  // === Caller-supplied plugins merge with the web plugin ===
  const bodyExtraPlugin = buildRequestBody("openai/gpt-5.5", messages, {
    webSearchEnabled: true,
    plugins: [{ id: "custom-plugin" }],
  }, true);
  assert.deepEqual(bodyExtraPlugin.plugins, [
    { id: "custom-plugin" },
    { id: "web", max_results: 5 },
  ]);

  // === webSearchMaxTotalResults is deprecated and does NOT affect wire body ===
  const bodyDeprecatedBudget = buildRequestBody("openai/gpt-5.5", messages, {
    webSearchEnabled: true,
    webSearchMaxTotalResults: 5,
  }, true);
  assert.deepEqual(
    bodyDeprecatedBudget.plugins,
    [{ id: "web", max_results: 5 }],
    "webSearchMaxTotalResults must be ignored — plugin form has no per-request cumulative cap",
  );
});

// ---------------------------------------------------------------------------
// REGRESSION: Web search uses the plugin form (`plugins: [{id:"web"}]`) and
// NEVER the server tool (`tools: [{type: "openrouter:web_search"}]`).
//
// Measured (Apr 2026, captured production body, curl TTFB):
//   moonshotai/kimi-k2.6: server-tool 10.21s vs plugin 3.93s (6.3s faster)
//   openai/gpt-5.5 + ZDR: server-tool 10.17s vs plugin 2.60s (7.6s faster)
//   openai/gpt-5.5 no ZDR: server-tool 0.50s vs plugin 0.82s (~0.3s slower, noise)
//
// The server tool adds an extra model round-trip (model emits tool call → OR
// executes search → results returned → model responds). The plugin searches
// up-front and injects results into the prompt, streaming the response in
// one pass. See docs/ttft-web-search-finding.md.
//
// OpenRouter has marked the plugin API as deprecated but it remains fully
// supported. When they sunset it we reintroduce the server-tool form (see git
// blame of `openrouter_request.ts` for the previous implementation).
//
// If this test fails because someone reintroduced the server tool, verify
// they have explicit latency numbers showing the plugin is no longer the
// faster path. Don't flip silently.
//
// Tracking:
//   Plugin docs: https://openrouter.ai/docs/guides/features/plugins/web-search
//   Server tool: https://openrouter.ai/docs/guides/features/server-tools/web-search
// ---------------------------------------------------------------------------
test("REGRESSION: web search always uses plugin form, never the server tool", () => {
  const messages = [{ role: "user" as const, content: "hello" }];

  const toolCapableBody = buildRequestBody("openai/gpt-5.5", messages, {
    webSearchEnabled: true,
    tools: [{ type: "function" as const, function: { name: "f", description: "f", parameters: {} } }],
  }, true);
  const tools = (toolCapableBody.tools as unknown[]) ?? [];
  for (const t of tools) {
    assert.notEqual(
      (t as any).type,
      "openrouter:web_search",
      "server tool must never appear on the wire",
    );
  }
  assert.deepEqual(toolCapableBody.plugins, [{ id: "web", max_results: 5 }]);

  // Non-tool model — tools stripped, plugin still used.
  const nonToolBody = buildRequestBody("baidu/ernie-4.5-300b-a47b", messages, {
    webSearchEnabled: true,
    tools: null as any,
  }, false);
  assert.equal(nonToolBody.tools, undefined);
  assert.deepEqual(nonToolBody.plugins, [{ id: "web", max_results: 5 }]);

  // End-to-end via gateParameters
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
  assert.equal(gated.tools, null);
  assert.equal(gated.webSearchEnabled, true);
  const bodyE2E = buildRequestBody("baidu/ernie-4.5-300b-a47b", messages, gated, false);
  assert.equal(bodyE2E.tools, undefined);
  assert.deepEqual(bodyE2E.plugins, [{ id: "web", max_results: 5 }]);
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
