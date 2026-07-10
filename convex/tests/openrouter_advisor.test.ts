import assert from "node:assert/strict";
import test from "node:test";
import { buildPersonaAdvisorTool } from "../lib/openrouter_advisor";
import { buildAdvisorResponsesBody } from "../lib/openrouter_responses";
import { availableProgressiveProfiles } from "../tools/progressive_registry_shared";

test("retired Advisor Skill profile is not available to progressive tools", () => {
  const profiles = availableProgressiveProfiles({ isPro: true });
  assert.equal(profiles.some((profile) => String(profile) === "advisor"), false);
});

test("Persona Advisor tool forwards transcript and maps optional web search", () => {
  const tool = buildPersonaAdvisorTool({
    instanceName: "persona_123",
    model: "anthropic/claude-sonnet-4",
    instructions: "Review this as the selected Persona.",
    maxCompletionTokens: 2_048,
    temperature: 0.4,
    reasoningEffort: "high",
    allowWebSearch: true,
  });
  assert.equal(tool.type, "openrouter:advisor");
  assert.deepEqual(tool.parameters, {
    name: "persona_123",
    model: "anthropic/claude-sonnet-4",
    instructions: "Review this as the selected Persona.",
    forward_transcript: true,
    stream: true,
    max_completion_tokens: 2_048,
    temperature: 0.4,
    reasoning: { effort: "high" },
    tools: [{
      type: "openrouter:web_search",
      parameters: {
        engine: "auto",
        max_results: 5,
        max_total_results: 15,
        search_context_size: "medium",
      },
    }],
    max_tool_calls: 5,
  });
});

test("Responses body requires exactly one Persona Advisor consultation", () => {
  const body = buildAdvisorResponsesBody({
    dispatcherModel: "openai/gpt-4.1-mini",
    input: [{
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Decide" }],
    }],
    instanceName: "persona_123",
    advisorModel: "anthropic/claude-sonnet-4",
    advisorInstructions: "Advise privately.",
    allowWebSearch: false,
    maxCompletionTokens: 2_048,
    idleTimeoutMs: 90_000,
    absoluteTimeoutMs: 420_000,
  });
  assert.equal(body.model, "openai/gpt-4.1-mini");
  assert.equal(body.tool_choice, "required");
  assert.equal(body.max_tool_calls, 1);
  assert.equal(body.stream, true);
  const tools = body.tools as Array<{ type: string; parameters: Record<string, unknown> }>;
  assert.equal(tools.length, 1);
  assert.equal(tools[0]?.type, "openrouter:advisor");
  assert.equal(tools[0]?.parameters.forward_transcript, true);
  assert.equal(tools[0]?.parameters.tools, undefined);
});
