import test from "node:test";
import assert from "node:assert/strict";
import {
  googleDataProviderIdentifiers,
  isGoogleDataAllowedModel,
} from "../models/google_data_providers";

test("Google Workspace provider allowlist accepts OpenRouter provider slugs", () => {
  assert.equal(
    isGoogleDataAllowedModel("google/gemini-2.5-pro", "google-ai-studio"),
    true,
  );
  assert.equal(
    isGoogleDataAllowedModel("openai/gpt-5.2", "openrouter"),
    true,
  );
  assert.equal(
    isGoogleDataAllowedModel("anthropic/claude-sonnet-4.5", "openrouter"),
    true,
  );
});

test("Google Workspace provider identifiers include metadata and slug", () => {
  assert.deepEqual(
    googleDataProviderIdentifiers("google/gemini-2.5-pro", "google-ai-studio"),
    new Set(["google-ai-studio", "google"]),
  );
  assert.equal(isGoogleDataAllowedModel("mistral/large", "mistral"), false);
});
