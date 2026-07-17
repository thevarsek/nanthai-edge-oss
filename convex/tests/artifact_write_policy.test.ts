import assert from "node:assert/strict";
import test from "node:test";

import {
  artifactTurnSystemGuidance,
  artifactWriteBlockMessage,
  IDEASCAPE_ARTIFACT_EDIT_GUIDANCE,
  MULTI_PARTICIPANT_ARTIFACT_GUIDANCE,
} from "../tools/artifact_write_policy";
import { createTool, ToolRegistry, type ToolExecutionContext } from "../tools/registry";

const statefulTools = [
  "create_presentation",
  "edit_presentation",
  "generate_pptx",
  "edit_pptx",
  "generate_docx",
  "edit_docx",
  "propose_docx_edits",
];

test("multi-participant turns block stateful PPTX and DOCX writes but allow reads", () => {
  for (const toolName of statefulTools) {
    assert.equal(
      artifactWriteBlockMessage(toolName, { turnParticipantCount: 3 }),
      MULTI_PARTICIPANT_ARTIFACT_GUIDANCE,
    );
  }
  assert.equal(
    artifactWriteBlockMessage("read_presentation", { turnParticipantCount: 3 }),
    null,
  );
  assert.equal(
    artifactWriteBlockMessage("read_docx", { turnParticipantCount: 3 }),
    null,
  );
});

test("Ideascape permits review and creation but keeps existing artifact edits in chat", () => {
  assert.equal(
    artifactWriteBlockMessage("edit_presentation", {
      turnParticipantCount: 1,
      isIdeascapeTurn: true,
    }),
    IDEASCAPE_ARTIFACT_EDIT_GUIDANCE,
  );
  assert.equal(
    artifactWriteBlockMessage("propose_docx_edits", {
      turnParticipantCount: 1,
      isIdeascapeTurn: true,
    }),
    IDEASCAPE_ARTIFACT_EDIT_GUIDANCE,
  );
  assert.equal(
    artifactWriteBlockMessage("create_presentation", {
      turnParticipantCount: 1,
      isIdeascapeTurn: true,
    }),
    null,
  );
  assert.equal(
    artifactWriteBlockMessage("read_pptx", {
      turnParticipantCount: 1,
      isIdeascapeTurn: true,
    }),
    null,
  );
});

test("tool registry enforces the artifact write guard before execution", async () => {
  let executions = 0;
  const registry = new ToolRegistry();
  registry.register(createTool({
    name: "edit_docx",
    description: "Edit a document",
    parameters: { type: "object", properties: {} },
    execute: async () => {
      executions += 1;
      return { success: true, data: { changed: true } };
    },
  }));

  const result = await registry.executeToolCall({
    id: "tool_1",
    type: "function",
    function: { name: "edit_docx", arguments: "{}" },
  }, {
    ctx: {} as ToolExecutionContext["ctx"],
    userId: "user_1",
    turnParticipantCount: 2,
  });

  assert.equal(executions, 0);
  assert.equal(result.result.success, false);
  assert.equal(result.result.error, MULTI_PARTICIPANT_ARTIFACT_GUIDANCE);
});

test("system guidance tells models how to recover without claiming a write", () => {
  const guidance = artifactTurnSystemGuidance({
    turnParticipantCount: 2,
    isIdeascapeTurn: true,
  });
  assert.match(guidance ?? "", /Open \+ → Participants/);
  assert.match(guidance ?? "", /return to Chat/);
  assert.match(guidance ?? "", /Do not claim that a file changed/);
});
