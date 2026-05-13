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
  };

  assert.equal(stripParameter("temperature", params)?.temperature, null);
  assert.equal(stripParameter("temperature", {}), null);
  assert.equal(stripParameter("max_tokens", params)?.maxTokens, null);
  assert.equal(stripParameter("include_reasoning", params)?.includeReasoning, null);
  assert.equal(stripParameter("reasoning", params)?.reasoningEffort, null);
  assert.equal(stripParameter("modalities", params)?.modalities, null);
  assert.equal(stripParameter("image_config", params)?.imageConfig, null);
  assert.equal(stripParameter("plugins", params)?.plugins, null);
  assert.equal(stripParameter("transforms", params)?.transforms, null);
  assert.equal(stripParameter("web_search", params)?.webSearchEnabled, false);

  assert.equal(stripParameter("max_tokens", { maxTokens: null }), null);
  assert.equal(stripParameter("include_reasoning", {}), null);
  assert.equal(stripParameter("reasoning", {}), null);
  assert.equal(stripParameter("modalities", {}), null);
  assert.equal(stripParameter("image_config", {}), null);
  assert.equal(stripParameter("plugins", {}), null);
  assert.equal(stripParameter("transforms", { transforms: null }), null);
  assert.equal(stripParameter("web_search", { webSearchEnabled: false }), null);
  assert.equal(stripParameter("unknown_param", params), null);
});
