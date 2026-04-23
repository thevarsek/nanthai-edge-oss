import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  filterExcludedOpenRouterProviders,
  isExcludedOpenRouterProvider,
} from "../models/provider_filters";

describe("model provider filters", () => {
  it("does not exclude deepseek or x-ai", () => {
    assert.equal(isExcludedOpenRouterProvider("deepseek"), false);
    assert.equal(isExcludedOpenRouterProvider("x-ai"), false);
    assert.equal(isExcludedOpenRouterProvider("X-AI"), false);
    assert.equal(isExcludedOpenRouterProvider("openai"), false);
    assert.equal(isExcludedOpenRouterProvider(undefined), false);
  });

  it("keeps deepseek and x-ai in model lists", () => {
    const models = [
      { provider: "openai", modelId: "openai/gpt-5" },
      { provider: "deepseek", modelId: "deepseek/chat" },
      { provider: "x-ai", modelId: "x-ai/grok-4" },
      { provider: "google", modelId: "google/gemini-2.5-pro" },
    ];

    assert.deepEqual(filterExcludedOpenRouterProviders(models), [
      { provider: "openai", modelId: "openai/gpt-5" },
      { provider: "deepseek", modelId: "deepseek/chat" },
      { provider: "x-ai", modelId: "x-ai/grok-4" },
      { provider: "google", modelId: "google/gemini-2.5-pro" },
    ]);
  });
});
