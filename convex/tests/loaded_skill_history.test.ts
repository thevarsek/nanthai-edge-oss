import assert from "node:assert/strict";
import test from "node:test";
import type { Doc, Id } from "../_generated/dataModel";
import type { ContextMessage } from "../chat/helpers_types";
import {
  restoredLoadedSkillsFromHistory,
  successfulLoadedSkillSlugsForBranch,
} from "../chat/loaded_skill_history";

const chatId = "chat_1" as Id<"chats">;

function message(
  id: string,
  role: ContextMessage["role"],
  parents: string[],
  extra: Partial<ContextMessage> = {},
): ContextMessage {
  return {
    _id: id as Id<"messages">,
    chatId,
    role,
    content: "",
    parentMessageIds: parents as Id<"messages">[],
    status: "complete",
    createdAt: 1,
    ...extra,
  };
}

function skill(slug: string): Doc<"skills"> {
  return {
    _id: `skill_${slug}`,
    _creationTime: 1,
    slug,
    name: "Presentations",
    instructionsRaw: "Current presentation instructions",
    runtimeMode: "node",
    requiredToolProfiles: ["presentations"],
    requiredToolIds: ["create_presentation", "edit_presentation"],
    requiredIntegrationIds: [],
    requiredCapabilities: [],
  } as unknown as Doc<"skills">;
}

test("loaded skill history follows only successful calls on the exact ancestor branch", () => {
  const messages = [
    message("root", "user", []),
    message("loaded", "assistant", ["root"], {
      toolCalls: [{ id: "load_1", name: "load_skill", arguments: '{"name":"pptx"}' }],
      toolResults: [{
        toolCallId: "load_1",
        toolName: "load_skill",
        result: '{"skill":"pptx"}',
      }],
    }),
    message("clarification", "user", ["loaded"]),
    message("current", "assistant", ["clarification"]),
    message("sibling", "assistant", ["root"], {
      toolCalls: [{ id: "load_2", name: "load_skill", arguments: '{"name":"documents"}' }],
      toolResults: [{
        toolCallId: "load_2",
        toolName: "load_skill",
        result: '{"skill":"documents"}',
      }],
    }),
    message("failed", "assistant", ["clarification"], {
      toolCalls: [{ id: "load_3", name: "load_skill", arguments: '{"name":"sheets"}' }],
      toolResults: [{
        toolCallId: "load_3",
        toolName: "load_skill",
        result: '{"error":"failed"}',
        isError: true,
      }],
    }),
  ];

  assert.deepEqual(
    successfulLoadedSkillSlugsForBranch(messages, "current" as Id<"messages">),
    ["pptx"],
  );
});

test("loaded skill restoration uses the current effective skill definition", () => {
  const messages = [
    message("root", "user", []),
    message("loaded", "assistant", ["root"], {
      toolCalls: [{ id: "load_1", name: "load_skill", arguments: '{"name":"pptx"}' }],
      toolResults: [{
        toolCallId: "load_1",
        toolName: "load_skill",
        result: '{"skill":"pptx"}',
      }],
    }),
    message("current", "assistant", ["loaded"]),
  ];

  const restored = restoredLoadedSkillsFromHistory(
    messages,
    "current" as Id<"messages">,
    [skill("pptx")],
  );
  assert.equal(restored.length, 1);
  assert.equal(restored[0]?.instructions, "Current presentation instructions");
  assert.deepEqual(restored[0]?.requiredToolProfiles, ["presentations"]);
  assert.deepEqual(restored[0]?.requiredToolIds, [
    "create_presentation",
    "edit_presentation",
  ]);
});
