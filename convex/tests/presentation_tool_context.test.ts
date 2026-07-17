import assert from "node:assert/strict";
import test from "node:test";
import { presentationContextForToolExecution } from "../chat/actions_run_generation_participant";
import {
  authoritativePresentationTarget,
} from "../tools/presentation_tool_shared";
import { serializableToolContext } from "../tools/proxy_context";
import type { ToolExecutionContext } from "../tools/registry";

function toolContext(): ToolExecutionContext {
  return {
    ctx: {} as never,
    userId: "user_1",
    chatId: "chat_1",
    messageId: "assistant_1",
    userMessageId: "user_1",
    modelId: "test/model",
    requireZdr: true,
    presentationContext: {
      projectId: "project_1" as never,
      projectRevision: 7,
      slideId: "slide_02",
      slideRevision: 3,
      elementId: "headline",
    },
  };
}

test("tool execution derives the typed target from the triggering user message", () => {
  const selected = presentationContextForToolExecution([
    {
      _id: "other_user",
      role: "user",
      content: "Other",
      presentationContext: {
        projectId: "wrong" as never,
        projectRevision: 1,
      },
    },
    {
      _id: "user_1",
      role: "user",
      content: "Shorten this",
      presentationContext: toolContext().presentationContext,
    },
  ], "user_1" as never);
  assert.deepEqual(selected, toolContext().presentationContext);
});

test("selected presentation context overrides omissions and rejects mismatches", () => {
  const context = toolContext();
  assert.deepEqual(authoritativePresentationTarget(context, { instruction: "Shorten it" }), {
    projectId: "project_1",
    projectRevision: 7,
    slideId: "slide_02",
    slideRevision: 3,
    slideNumber: undefined,
    elementId: "headline",
  });
  assert.throws(
    () => authoritativePresentationTarget(context, {
      projectId: "project_2",
      slideId: "slide_99",
    }),
    /did not match the user's selected presentation target/,
  );
});

test("presentation proxy context preserves target and turn privacy constraint", () => {
  const serialized = serializableToolContext(toolContext());
  assert.equal(serialized.requireZdr, true);
  assert.deepEqual(serialized.presentationContext, toolContext().presentationContext);
  assert.equal("ctx" in serialized, false);
});
