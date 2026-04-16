import assert from "node:assert/strict";
import test from "node:test";

import type { OpenRouterMessage, ToolCall } from "../lib/openrouter";
import {
  availableProgressiveProfiles,
  buildProgressiveToolRegistry,
  buildRegistryParams,
  extractProfilesFromConversation,
  extractProfilesFromLoadSkillResults,
  patchSameRoundProgressiveToolErrors,
  retrySameRoundProgressiveToolCalls,
} from "../tools/progressive_registry";

test("buildProgressiveToolRegistry: base Pro registry omits docs and runtime tools", () => {
  const registry = buildProgressiveToolRegistry({
    isPro: true,
    enabledIntegrations: [],
    allowSubagents: false,
  });

  assert.ok(registry.get("load_skill"));
  assert.ok(registry.get("search_chats"));
  assert.equal(registry.get("create_persona"), undefined);
  assert.equal(registry.get("spawn_subagents"), undefined);
  assert.equal(registry.get("generate_docx"), undefined);
  assert.equal(registry.get("workspace_exec"), undefined);
  assert.equal(registry.get("data_python_exec"), undefined);
});

test("buildProgressiveToolRegistry: direct attachment read tools can be exposed without docs profile", () => {
  const registry = buildProgressiveToolRegistry({
    isPro: true,
    enabledIntegrations: [],
    allowSubagents: false,
    directToolNames: ["read_text_file", "read_docx"],
  });

  assert.ok(registry.get("read_text_file"));
  assert.ok(registry.get("read_docx"));
  assert.equal(registry.get("generate_text_file"), undefined);
  assert.equal(registry.get("edit_docx"), undefined);
});

test("buildProgressiveToolRegistry: docs profile adds document tools", () => {
  const registry = buildProgressiveToolRegistry({
    isPro: true,
    enabledIntegrations: [],
    allowSubagents: false,
    activeProfiles: ["docs"],
  });

  assert.ok(registry.get("generate_docx"));
  assert.ok(registry.get("generate_xlsx"));
});

test("buildProgressiveToolRegistry: workspace and analytics profiles expand separately", () => {
  const analyticsRegistry = buildProgressiveToolRegistry({
    isPro: true,
    enabledIntegrations: [],
    allowSubagents: false,
    activeProfiles: ["analytics"],
  });
  assert.ok(analyticsRegistry.get("data_python_exec"));
  assert.ok(analyticsRegistry.get("data_python_sandbox"), "analytics profile should include data_python_sandbox");
  assert.equal(analyticsRegistry.get("workspace_exec"), undefined);

  const workspaceRegistry = buildProgressiveToolRegistry({
    isPro: true,
    enabledIntegrations: [],
    allowSubagents: false,
    activeProfiles: ["workspace"],
  });
  assert.ok(workspaceRegistry.get("workspace_exec"));
  assert.equal(workspaceRegistry.get("data_python_exec"), undefined);

  const persistentRegistry = buildProgressiveToolRegistry({
    isPro: true,
    enabledIntegrations: [],
    allowSubagents: false,
    activeProfiles: ["persistentRuntime"],
  });
  assert.ok(persistentRegistry.get("vm_exec"));
  assert.ok(persistentRegistry.get("read_pdf"));
  assert.equal(persistentRegistry.get("workspace_exec"), undefined);
});

test("buildProgressiveToolRegistry: integration profiles only add enabled integrations", () => {
  const registry = buildProgressiveToolRegistry({
    isPro: true,
    enabledIntegrations: ["gmail"],
    allowSubagents: false,
    activeProfiles: ["google"],
  });

  assert.ok(registry.get("gmail_send"));
  assert.equal(registry.get("drive_upload"), undefined);
  assert.equal(registry.get("calendar_create"), undefined);
});

test("buildProgressiveToolRegistry: subagents profile adds spawn_subagents only when allowed", () => {
  const allowed = buildProgressiveToolRegistry({
    isPro: true,
    enabledIntegrations: [],
    allowSubagents: true,
    activeProfiles: ["subagents"],
  });
  assert.ok(allowed.get("spawn_subagents"));

  const blocked = buildProgressiveToolRegistry({
    isPro: true,
    enabledIntegrations: [],
    allowSubagents: false,
    activeProfiles: ["subagents"],
  });
  assert.equal(blocked.get("spawn_subagents"), undefined);
});

test("availableProgressiveProfiles: reflects integrations and runtime capability", () => {
  const profiles = availableProgressiveProfiles({
    isPro: true,
    enabledIntegrations: ["gmail", "notion"],
    allowSubagents: true,
  });

  assert.ok(profiles.includes("docs"));
  assert.ok(profiles.includes("analytics"));
  assert.ok(profiles.includes("workspace"));
  assert.ok(profiles.includes("persistentRuntime"));
  assert.ok(profiles.includes("subagents"));
  assert.ok(profiles.includes("google"));
  assert.ok(profiles.includes("notion"));
  assert.ok(!profiles.includes("microsoft"));
});

test("buildRegistryParams: includes tools and auto choice when registry is non-empty", () => {
  const registry = buildProgressiveToolRegistry({
    isPro: true,
    enabledIntegrations: [],
    allowSubagents: false,
  });
  const params = buildRegistryParams(registry);
  assert.equal(params.toolChoice, "auto");
  assert.ok(Array.isArray(params.tools));
  assert.ok(params.tools && params.tools.length > 0);
});

test("extractProfilesFromLoadSkillResults: reads required profiles from successful load_skill results", () => {
  const toolCalls = [
    {
      id: "call_1",
      function: { name: "load_skill", arguments: "{\"name\":\"xlsx\"}" },
    },
  ] as ToolCall[];
  const results = [
    {
      toolCallId: "call_1",
      result: {
        success: true,
        data: { requiredToolProfiles: ["docs", "analytics", "unknown"] },
      },
    },
  ];

  assert.deepEqual(
    extractProfilesFromLoadSkillResults(toolCalls, results),
    ["docs", "analytics"],
  );
});

test("extractProfilesFromConversation: restores profiles from prior load_skill tool messages", () => {
  const messages: OpenRouterMessage[] = [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "load_skill", arguments: "{\"name\":\"data-analyzer\"}" },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "call_1",
      content: JSON.stringify({ requiredToolProfiles: ["analytics"] }),
    },
  ];

  assert.deepEqual(extractProfilesFromConversation(messages), ["analytics"]);
});

test("historically loaded profiles can seed the next request registry", () => {
  const messages: OpenRouterMessage[] = [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "load_skill", arguments: "{\"name\":\"data-analyzer\"}" },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "call_1",
      content: JSON.stringify({ requiredToolProfiles: ["analytics"] }),
    },
  ];

  const restoredProfiles = extractProfilesFromConversation(messages);
  const registry = buildProgressiveToolRegistry({
    isPro: true,
    enabledIntegrations: [],
    allowSubagents: false,
    activeProfiles: restoredProfiles,
  });

  assert.ok(registry.get("data_python_exec"));
});

test("patchSameRoundProgressiveToolErrors: rewrites same-step unknown tool errors after skill load", () => {
  const toolCalls = [
    {
      id: "call_1",
      function: { name: "load_skill", arguments: "{\"name\":\"docx\"}" },
    },
    {
      id: "call_2",
      function: { name: "generate_docx", arguments: "{\"title\":\"x\",\"sections\":[]}" },
    },
  ] as ToolCall[];
  const results = [
    {
      toolCallId: "call_1",
      result: {
        success: true,
        data: { requiredToolProfiles: ["docs"] },
      },
    },
    {
      toolCallId: "call_2",
      result: {
        success: false,
        data: null,
        error: "Unknown tool: \"generate_docx\". Available tools: load_skill",
      },
    },
  ];

  const nextRegistry = buildProgressiveToolRegistry({
    isPro: true,
    enabledIntegrations: [],
    allowSubagents: false,
    activeProfiles: ["docs"],
  });

  patchSameRoundProgressiveToolErrors(toolCalls, results, nextRegistry);

  assert.equal(results[1]?.result.success, false);
  assert.match(results[1]?.result.error ?? "", /requested too early/i);
  assert.deepEqual(results[1]?.result.data, {
    retryNextTurn: true,
    tool: "generate_docx",
    message:
      "Tool \"generate_docx\" was requested in the same step as skill loading. " +
      "The matching skill/profile is now loaded, so re-plan and call \"generate_docx\" again in your next response.",
  });
});

test("retrySameRoundProgressiveToolCalls: executes newly unlocked tools after load_skill", async () => {
  const toolCalls = [
    {
      id: "call_1",
      type: "function",
      function: { name: "load_skill", arguments: "{\"name\":\"docx\"}" },
    },
    {
      id: "call_2",
      type: "function",
      function: {
        name: "generate_docx",
        arguments: JSON.stringify({
          title: "Iran report",
          sections: [{ heading: "Overview", body: "Latest situation." }],
        }),
      },
    },
  ] as ToolCall[];
  const results = [
    {
      toolCallId: "call_1",
      result: {
        success: true,
        data: { requiredToolProfiles: ["docs"] },
      },
    },
    {
      toolCallId: "call_2",
      result: {
        success: false,
        data: null,
        error: "Unknown tool: \"generate_docx\". Available tools: load_skill",
      },
    },
  ];

  const nextRegistry = buildProgressiveToolRegistry({
    isPro: true,
    enabledIntegrations: [],
    allowSubagents: false,
    activeProfiles: ["docs"],
  });

  await retrySameRoundProgressiveToolCalls(
    toolCalls,
    results,
    nextRegistry,
    {
      ctx: {
        storage: {
          store: async () => "storage_123",
          getUrl: async () => "https://example.com/docx",
        },
      } as never,
      userId: "user_123",
      chatId: "chat_123",
    },
  );

  assert.equal(results[1]?.result.success, true);
  assert.equal(
    (results[1]?.result.data as { filename?: string }).filename,
    "Iran report.docx",
  );
});
