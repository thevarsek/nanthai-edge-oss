import assert from "node:assert/strict";
import test from "node:test";

import type { OpenRouterMessage, ToolCall } from "../lib/openrouter";
import { createTool, ToolRegistry, type ToolExecutionContext } from "../tools/registry";
import {
  availableProgressiveProfiles,
  buildRegistryParams,
  extractLoadedSkillsFromConversation,
  extractLoadedSkillsFromLoadSkillResults,
  extractProfilesFromConversation,
  extractProfilesFromLoadSkillResults,
  mergeLoadedSkills,
  patchSameRoundProgressiveToolErrors,
  retrySameRoundProgressiveToolCalls,
} from "../tools/progressive_registry";
import { patchDeferredProgressiveToolErrors } from "../tools/progressive_registry_shared";

test("loaded skill extraction ignores malformed, failed, and non-load_skill tool results", () => {
  const toolCalls = [
    { function: { name: "load_skill" } },
    { function: { name: "load_skill" } },
    { function: { name: "search_chats" } },
    { function: { name: "load_skill" } },
  ];
  const results = [
    { toolCallId: "ok", result: { success: true, data: {
      skill: "workspace",
      name: 42,
      runtimeMode: "toolAugmented",
      instructions: "Use the workspace.",
      requiredToolProfiles: ["workspace", "bogus"],
      requiredToolIds: ["workspace_exec", 1],
      requiredIntegrationIds: ["gmail", false],
      requiredCapabilities: ["pro", null],
    } } },
    { toolCallId: "failed", result: { success: false, data: {
      skill: "docs",
      instructions: "failed payload",
      requiredToolProfiles: ["docs"],
    } } },
    { toolCallId: "other", result: { success: true, data: {
      skill: "ignored",
      instructions: "not load_skill",
      requiredToolProfiles: ["docs"],
    } } },
    { toolCallId: "bad", result: { success: true, data: {
      skill: "missing instructions",
      requiredToolProfiles: ["docs"],
    } } },
  ];

  assert.deepEqual(extractProfilesFromLoadSkillResults(toolCalls, results), ["workspace", "docs"]);
  assert.deepEqual(extractLoadedSkillsFromLoadSkillResults(toolCalls, results), [{
    skill: "workspace",
    name: undefined,
    runtimeMode: "toolAugmented",
    instructions: "Use the workspace.",
    requiredToolProfiles: ["workspace", "google"],
    requiredToolIds: ["workspace_exec"],
    requiredIntegrationIds: ["gmail"],
    requiredCapabilities: ["pro"],
  }]);
});

test("conversation extraction handles structured text, empty content, malformed JSON, and stale tool ids", () => {
  const messages: OpenRouterMessage[] = [
    { role: "tool", tool_call_id: "before_assistant", content: "{\"requiredToolProfiles\":[\"docs\"]}" },
    {
      role: "assistant",
      content: null,
      tool_calls: [{
        id: "call_docs",
        type: "function",
        function: { name: "load_skill", arguments: "{}" },
      }],
    },
    { role: "tool", tool_call_id: "call_docs", content: "" },
    { role: "tool", tool_call_id: "call_docs", content: [{ type: "image_url", image_url: { url: "x" } }] as never },
    { role: "tool", tool_call_id: "call_docs", content: "{" },
    { role: "tool", tool_call_id: "stale", content: JSON.stringify({
      skill: "ignored",
      instructions: "not linked to load_skill",
      requiredToolProfiles: ["docs"],
    }) },
    { role: "tool", tool_call_id: "call_docs", content: JSON.stringify({
      skill: "docx",
      instructions: "Use heading styles.",
      requiredToolProfiles: ["docs"],
      requiredToolIds: ["generate_docx"],
      requiredIntegrationIds: [],
      requiredCapabilities: [],
    }) },
    { role: "tool", tool_call_id: "call_docs", content: [{ type: "text", text: JSON.stringify({
      skill: "docx",
      instructions: "Use heading styles.",
      requiredToolProfiles: ["docs", "bogus"],
      requiredToolIds: ["generate_docx"],
      requiredIntegrationIds: [],
      requiredCapabilities: [],
    }) }] },
  ];

  assert.deepEqual(extractProfilesFromConversation(messages), ["docs"]);
  assert.deepEqual(extractLoadedSkillsFromConversation(messages), [{
    skill: "docx",
    name: undefined,
    runtimeMode: undefined,
    instructions: "Use heading styles.",
    requiredToolProfiles: ["docs"],
    requiredToolIds: ["generate_docx"],
    requiredIntegrationIds: [],
    requiredCapabilities: [],
  }]);
});

test("progressive registry patchers leave non-actionable results unchanged", () => {
  const registry = new ToolRegistry();
  registry.register(createTool({
    name: "generate_docx",
    description: "Generate a docx",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ success: true, data: { ok: true } }),
  }));
  const toolCalls = [
    { function: { name: "load_skill" } },
    { function: { name: "generate_docx" } },
    { function: { name: "missing_tool" } },
    { function: { name: "" } },
  ];
  const results = [
    { toolCallId: "load", result: { success: true, data: { requiredToolProfiles: ["docs"] } } },
    { toolCallId: "already_ok", result: { success: true, data: { ok: true } } },
    { toolCallId: "wrong_error", result: { success: false, data: null, error: "Permission denied" } },
    { toolCallId: "no_result", result: undefined },
  ];

  const before = structuredClone(results);
  patchSameRoundProgressiveToolErrors(toolCalls, results as never, registry);
  patchDeferredProgressiveToolErrors(toolCalls, results as never);

  assert.deepEqual(results, before);
});

test("same-round retry skips unknown tools until a newly loaded registry can execute them", async () => {
  const registry = new ToolRegistry();
  const calls: string[] = [];
  registry.register(createTool({
    name: "generate_docx",
    description: "Generate a docx",
    parameters: { type: "object", properties: {} },
    execute: async (_toolCtx, args) => {
      calls.push(String(args.title ?? "untitled"));
      return { success: true, data: { filename: `${args.title}.docx` } };
    },
  }));

  const toolCalls = [
    {
      id: "load",
      type: "function",
      function: { name: "load_skill", arguments: "{}" },
    },
    {
      id: "retry",
      type: "function",
      function: { name: "generate_docx", arguments: "{\"title\":\"Plan\"}" },
    },
    {
      id: "not_retry",
      type: "function",
      function: { name: "missing_tool", arguments: "{}" },
    },
  ] as ToolCall[];
  const results = [
    { toolCallId: "load", result: { success: true, data: { requiredToolProfiles: ["docs"] } } },
    { toolCallId: "retry", result: { success: false, data: null, error: "Unknown tool: generate_docx" } },
    { toolCallId: "not_retry", result: { success: false, data: null, error: "Unknown tool: missing_tool" } },
  ];

  await retrySameRoundProgressiveToolCalls(
    toolCalls,
    results,
    registry,
    { ctx: {} as never, userId: "user_123" } as ToolExecutionContext,
  );

  assert.deepEqual(calls, ["Plan"]);
  assert.deepEqual(results[1], {
    toolCallId: "retry",
    result: { success: true, data: { filename: "Plan.docx" } },
  });
  assert.equal(results[2]?.result.error, "Unknown tool: missing_tool");
});

test("registry params, profile availability, and merge helpers cover empty and gating branches", () => {
  assert.deepEqual(buildRegistryParams(new ToolRegistry()), {});
  assert.deepEqual(availableProgressiveProfiles({ isPro: false, enabledIntegrations: ["gmail"], allowSubagents: true }), []);
  assert.deepEqual(
    availableProgressiveProfiles({
      isPro: true,
      enabledIntegrations: ["drive", "calendar", "onedrive", "ms_calendar", "apple_calendar", "cloze", "slack"],
      allowSubagents: false,
    }),
    [
      "presentations",
      "docs",
      "analytics",
      "workspace",
      "persistentRuntime",
      "scheduledJobs",
      "skillsManagement",
      "google",
      "microsoft",
      "appleCalendar",
      "cloze",
      "slack",
    ],
  );
  assert.deepEqual(mergeLoadedSkills(undefined, [], undefined), []);
});

test("deferred progressive patcher handles missing load result data without rewriting errors", () => {
  const toolCalls = [
    { function: { name: "load_skill" } },
    { function: { name: "generate_docx" } },
  ];
  const results = [
    { toolCallId: "load", result: { success: true, data: null } },
    { toolCallId: "tool", result: { success: false, data: null, error: "Unknown tool: generate_docx" } },
  ];

  patchDeferredProgressiveToolErrors(toolCalls, results);

  assert.deepEqual(results, [
    { toolCallId: "load", result: { success: true, data: null } },
    { toolCallId: "tool", result: { success: false, data: null, error: "Unknown tool: generate_docx" } },
  ]);
});
