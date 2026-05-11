import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRetryContract,
  cloneRetryContract,
  type RetryContract,
} from "../chat/retry_contract";
import { classifyTerminalErrorCode } from "../chat/terminal_error";

test("retry contracts deep-clone participant snapshots, overrides, integrations, and video config", () => {
  const original: RetryContract = {
    participants: [
      {
        modelId: "openai/gpt-5",
        personaId: "persona_1" as any,
        personaName: "Planner",
        temperature: 0.4,
        includeReasoning: true,
      },
      {
        modelId: "anthropic/claude-sonnet-4",
        personaAvatarImageUrl: "https://example.com/avatar.png",
        reasoningEffort: "high",
      },
    ],
    searchMode: "web",
    searchComplexity: 3,
    enabledIntegrations: ["google_drive", "slack"],
    subagentsEnabled: true,
    turnSkillOverrides: [{ skillId: "skill_1" as any, state: "always" }],
    turnIntegrationOverrides: [{ integrationId: "slack", enabled: false }],
    videoConfig: { resolution: "1080p", aspectRatio: "16:9", duration: 8 },
  };

  const cloned = cloneRetryContract(original);
  original.participants[0].modelId = "mutated";
  original.enabledIntegrations?.push("notion");
  original.turnSkillOverrides?.push({ skillId: "skill_2" as any, state: "never" });
  if (original.turnIntegrationOverrides?.[0]) {
    original.turnIntegrationOverrides[0].enabled = true;
  }
  original.videoConfig!.duration = 4;

  assert.deepEqual(cloned, {
    participants: [
      {
        modelId: "openai/gpt-5",
        personaId: "persona_1",
        personaName: "Planner",
        personaEmoji: null,
        personaAvatarImageUrl: null,
        systemPrompt: null,
        temperature: 0.4,
        maxTokens: undefined,
        includeReasoning: true,
        reasoningEffort: null,
      },
      {
        modelId: "anthropic/claude-sonnet-4",
        personaId: null,
        personaName: null,
        personaEmoji: null,
        personaAvatarImageUrl: "https://example.com/avatar.png",
        systemPrompt: null,
        temperature: undefined,
        maxTokens: undefined,
        includeReasoning: undefined,
        reasoningEffort: "high",
      },
    ],
    searchMode: "web",
    searchComplexity: 3,
    enabledIntegrations: ["google_drive", "slack"],
    subagentsEnabled: true,
    turnSkillOverrides: [{ skillId: "skill_1", state: "always" }],
    turnIntegrationOverrides: [{ integrationId: "slack", enabled: false }],
    videoConfig: { resolution: "1080p", aspectRatio: "16:9", duration: 8 },
  });
});

test("buildRetryContract only preserves search complexity for web searches", () => {
  const base: RetryContract = {
    participants: [{ modelId: "openai/gpt-5" }],
    searchMode: "normal",
    searchComplexity: 3,
  };

  assert.equal(buildRetryContract(base).searchComplexity, undefined);
  assert.equal(
    buildRetryContract({ ...base, searchMode: "web" }).searchComplexity,
    3,
  );
  assert.equal(
    buildRetryContract({ ...base, searchMode: "none" }).searchComplexity,
    undefined,
  );
});

test("terminal error classification preserves explicit codes and maps client-visible failure reasons", () => {
  assert.equal(
    classifyTerminalErrorCode({ status: "completed", error: "provider timeout" }),
    undefined,
  );
  assert.equal(
    classifyTerminalErrorCode({
      status: "failed",
      existingCode: "cancelled_by_retry",
      error: "OpenRouter timed out",
    }),
    "cancelled_by_retry",
  );
  assert.equal(
    classifyTerminalErrorCode({ status: "cancelled", error: "user stopped generation" }),
    "cancelled_by_user",
  );
  assert.equal(
    classifyTerminalErrorCode({ status: "failed", error: "stream timeout after 8m" }),
    "stream_timeout",
  );
  assert.equal(
    classifyTerminalErrorCode({ status: "failed", error: "OpenRouter provider error" }),
    "provider_error",
  );
  assert.equal(
    classifyTerminalErrorCode({ status: "failed", error: "unexpected empty response" }),
    "unknown_error",
  );
  assert.equal(
    classifyTerminalErrorCode({ status: "failed" }),
    "unknown_error",
  );
});
