import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeUnsupportedParameterName,
  parseUnsupportedParameter,
  stripParameter,
} from "../lib/openrouter_param_retry";

test("unsupported parameter parser handles provider text, JSON strings, and nested arrays", () => {
  assert.equal(
    parseUnsupportedParameter("unsupported request parameter: `max_output_tokens`"),
    "max_tokens",
  );
  assert.equal(
    parseUnsupportedParameter("Model does not support the parameter imageConfig"),
    "image_config",
  );
  assert.equal(
    parseUnsupportedParameter("unknown provider setting: modalities"),
    "modalities",
  );
  assert.equal(
    parseUnsupportedParameter(JSON.stringify({
      error: {
        metadata: [
          { ignored: true },
          { detail: "cannot find field reasoning.effort" },
        ],
      },
    })),
    "reasoning",
  );
  assert.equal(parseUnsupportedParameter("not json and not supported"), null);
});

test("unsupported parameter parser prefers direct structured fields and stops at the depth guard", () => {
  assert.equal(
    parseUnsupportedParameter({ unsupportedParam: "response.max_completion_tokens" }),
    "max_tokens",
  );
  assert.equal(parseUnsupportedParameter({ unsupported_parameter: "plugins" }), "plugins");
  assert.equal(parseUnsupportedParameter(["", { parameter: "transforms" }]), "transforms");
  assert.equal(parseUnsupportedParameter(42), null);

  const deeplyNested = {
    error: {
      response: {
        cause: {
          details: {
            raw: {
              metadata: {
                message: "unknown name temperature",
              },
            },
          },
        },
      },
    },
  };
  assert.equal(parseUnsupportedParameter(deeplyNested), null);
  assert.equal(normalizeUnsupportedParameterName("provider.reasoning_effort"), "reasoning");
});

test("stripParameter clears each retryable OpenRouter setting only when it is present", () => {
  const params = {
    temperature: 0.2,
    maxTokens: 500,
    includeReasoning: true,
    reasoningEffort: "high" as const,
    modalities: ["text", "image"],
    imageConfig: { aspectRatio: "16:9" },
    plugins: [{ id: "web" }],
    transforms: ["middle-out"],
    webSearchEnabled: true,
    responseFormat: { type: "json_object" as const },
  };

  assert.equal(stripParameter("temperature", params)?.temperature, null);
  assert.equal(stripParameter("temperature", {}), null);
  assert.equal(stripParameter("max_tokens", params)?.maxTokens, null);
  assert.equal(stripParameter("include_reasoning", params)?.includeReasoning, null);
  assert.equal(stripParameter("reasoning", params)?.reasoningEffort, null);
  assert.equal(stripParameter("modalities", params)?.modalities, null);
  assert.equal(stripParameter("image_config", params)?.imageConfig, null);
  const strippedPlugins = stripParameter("plugins", params);
  assert.equal(strippedPlugins?.plugins, null);
  assert.equal(strippedPlugins?.webSearchEnabled, false);
  assert.equal(stripParameter("transforms", params)?.transforms, null);
  assert.equal(stripParameter("response_format", params)?.responseFormat, null);
  const strippedWebSearch = stripParameter("web_search", params);
  assert.equal(strippedWebSearch?.webSearchEnabled, false);
  assert.equal(strippedWebSearch?.plugins, null);

  assert.deepEqual(
    stripParameter("plugins", { webSearchEnabled: true }),
    { webSearchEnabled: false },
  );
  assert.deepEqual(
    stripParameter("web_search", {
      plugins: [{ id: "custom" }, { id: "web", max_results: 5 }],
      webSearchEnabled: true,
    })?.plugins,
    [{ id: "custom" }],
  );
  assert.equal(
    stripParameter("web_search", {
      plugins: [{ id: "web", max_results: 5 }],
      webSearchEnabled: false,
    })?.plugins,
    null,
  );

  assert.equal(stripParameter("max_tokens", { maxTokens: null }), null);
  assert.equal(stripParameter("include_reasoning", {}), null);
  assert.equal(stripParameter("reasoning", {}), null);
  assert.equal(stripParameter("modalities", {}), null);
  assert.equal(stripParameter("image_config", {}), null);
  assert.equal(stripParameter("plugins", {}), null);
  assert.equal(stripParameter("transforms", { transforms: null }), null);
  assert.equal(stripParameter("web_search", { webSearchEnabled: false }), null);
  assert.equal(stripParameter("response_format", {}), null);
  assert.equal(stripParameter("unknown_param", params), null);
});
