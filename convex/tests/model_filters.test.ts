import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  meetsMinContext,
  meetsMaxPrice,
  isEligibleModel,
} from "../models/model_filters";

// -- meetsMinContext ----------------------------------------------------------

describe("meetsMinContext", () => {
  it("rejects models below 100K context", () => {
    assert.equal(meetsMinContext(50_000, "openai"), false);
    assert.equal(meetsMinContext(99_999, "anthropic"), false);
  });

  it("accepts models at or above 100K context", () => {
    assert.equal(meetsMinContext(100_000, "openai"), true);
    assert.equal(meetsMinContext(200_000, "anthropic"), true);
  });

  it("uses 32K threshold for Google models", () => {
    assert.equal(meetsMinContext(31_999, "google"), false);
    assert.equal(meetsMinContext(32_000, "google"), true);
    assert.equal(meetsMinContext(65_000, "google"), true);
  });

  it("rejects undefined context length", () => {
    assert.equal(meetsMinContext(undefined, "openai"), false);
  });

  it("treats undefined provider as non-Google (100K threshold)", () => {
    assert.equal(meetsMinContext(50_000, undefined), false);
    assert.equal(meetsMinContext(100_000, undefined), true);
  });
});

// -- meetsMaxPrice ------------------------------------------------------------

describe("meetsMaxPrice", () => {
  it("accepts models at or below $50 output price", () => {
    assert.equal(meetsMaxPrice(0), true);
    assert.equal(meetsMaxPrice(10), true);
    assert.equal(meetsMaxPrice(50), true);
  });

  it("rejects models above $50 output price", () => {
    assert.equal(meetsMaxPrice(50.01), false);
    assert.equal(meetsMaxPrice(60), false);
    assert.equal(meetsMaxPrice(200), false);
  });

  it("accepts models with undefined price (unknown = keep)", () => {
    assert.equal(meetsMaxPrice(undefined), true);
  });
});

// -- isEligibleModel (composite) ----------------------------------------------

describe("isEligibleModel", () => {
  it("accepts a model passing all filters", () => {
    assert.equal(
      isEligibleModel({
        provider: "openai",
        contextLength: 128_000,
        outputPricePer1M: 15,
      }),
      true,
    );
  });

  it("rejects a model with insufficient context", () => {
    assert.equal(
      isEligibleModel({
        provider: "openai",
        contextLength: 8_000,
        outputPricePer1M: 10,
      }),
      false,
    );
  });

  it("rejects a model with output price > $50", () => {
    assert.equal(
      isEligibleModel({
        provider: "openai",
        contextLength: 128_000,
        outputPricePer1M: 60,
      }),
      false,
    );
  });

  it("rejects a model failing both filters", () => {
    assert.equal(
      isEligibleModel({
        provider: "anthropic",
        contextLength: 1_000,
        outputPricePer1M: 100,
      }),
      false,
    );
  });

  it("accepts a Google model with 32K context and cheap price", () => {
    assert.equal(
      isEligibleModel({
        provider: "google",
        contextLength: 32_000,
        outputPricePer1M: 5,
      }),
      true,
    );
  });

  it("accepts a model with undefined price and good context", () => {
    assert.equal(
      isEligibleModel({
        provider: "openai",
        contextLength: 200_000,
        outputPricePer1M: undefined,
      }),
      true,
    );
  });

  it("handles null provider", () => {
    assert.equal(
      isEligibleModel({
        provider: null,
        contextLength: 128_000,
        outputPricePer1M: 10,
      }),
      true,
    );
  });

  // -- Video model exemptions -------------------------------------------------

  it("accepts video models with zero context length", () => {
    assert.equal(
      isEligibleModel({
        provider: "bytedance",
        contextLength: 0,
        outputPricePer1M: undefined,
        supportsVideo: true,
      }),
      true,
    );
  });

  it("accepts video models with undefined context length", () => {
    assert.equal(
      isEligibleModel({
        provider: "openai",
        contextLength: undefined,
        outputPricePer1M: undefined,
        supportsVideo: true,
      }),
      true,
    );
  });

  it("accepts video models regardless of price", () => {
    assert.equal(
      isEligibleModel({
        provider: "google",
        contextLength: undefined,
        outputPricePer1M: 200,
        supportsVideo: true,
      }),
      true,
    );
  });

  it("does NOT exempt non-video models from context check", () => {
    assert.equal(
      isEligibleModel({
        provider: "openai",
        contextLength: 0,
        outputPricePer1M: 10,
        supportsVideo: false,
      }),
      false,
    );
  });

  it("does NOT exempt models without supportsVideo from context check", () => {
    assert.equal(
      isEligibleModel({
        provider: "openai",
        contextLength: 0,
        outputPricePer1M: 10,
      }),
      false,
    );
  });
});

// -- isFree (:free suffix convention) -----------------------------------------
// The isFree field in listModelSummaries uses `modelId.endsWith(":free")`.
// These tests document the convention and guard against regressions.

describe("isFree (modelId :free suffix)", () => {
  /** Mirror of the server-side isFree derivation in queries.ts. */
  const isFree = (modelId: string) => modelId.endsWith(":free");

  it("identifies :free-suffixed models as free", () => {
    assert.equal(isFree("openai/gpt-4o-mini:free"), true);
    assert.equal(isFree("google/gemma-3-1b-it:free"), true);
    assert.equal(isFree("meta-llama/llama-3-8b-instruct:free"), true);
  });

  it("does NOT mark zero-price models without :free suffix as free", () => {
    // Audio models like Lyria report $0 token prices but charge per request
    assert.equal(isFree("google/lyria-3-clip-preview"), false);
    assert.equal(isFree("google/lyria-3-pro-preview"), false);
  });

  it("does NOT mark standard paid models as free", () => {
    assert.equal(isFree("openai/gpt-4o"), false);
    assert.equal(isFree("anthropic/claude-sonnet-4"), false);
    assert.equal(isFree("google/gemini-2.5-pro-preview"), false);
  });

  it("handles edge cases", () => {
    // Substring ":free" not at end
    assert.equal(isFree("some-model:free-preview"), false);
    // Empty string
    assert.equal(isFree(""), false);
    // Just the suffix
    assert.equal(isFree(":free"), true);
  });
});
