import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import {
  buildSchedulerPrompt,
  deterministicSchedulerDecision,
  humanOpenedFloor,
  parseSchedulerDecision,
  parseSchedulerDecisionOrSilence,
  type SchedulerPolicyInput,
} from "../collaboration/scheduler_policy";
import { schedulerResponseFormat } from "../collaboration/scheduler_response_format";

const participantId = (value: string) => value as Id<"chatParticipants">;
const messageId = (value: string) => value as Id<"messages">;

function input(overrides: Partial<SchedulerPolicyInput> = {}): SchedulerPolicyInput {
  const frontier = messageId("message-user-1");
  return {
    wave: 1,
    frontierMessageIds: [frontier],
    participants: [
      {
        participantId: participantId("architect"),
        modelId: "openai/gpt-5.6-sol",
        displayName: "Architect",
        roleSummary: "Own architecture and consequential review.",
      },
      {
        participantId: participantId("ui"),
        modelId: "moonshotai/kimi-k3",
        displayName: "UI expert",
        roleSummary: "Own interaction and visual layout guidance.",
      },
      {
        participantId: participantId("implementer"),
        modelId: "openai/gpt-5.6-luna",
        displayName: "Implementer",
        roleSummary: "Implement and verify code changes.",
      },
    ],
    mentionedParticipantIds: [],
    failedParticipantIds: [],
    previousSpeakerIds: [],
    recentMessages: [{
      id: frontier,
      role: "user",
      speaker: "User",
      content: "Implement a compact settings card.",
    }],
    remainingMessageBudget: 8,
    deadlineReached: false,
    ...overrides,
  };
}

test("direct mentions deterministically constrain the next wave", () => {
  const result = deterministicSchedulerDecision(input({
    mentionedParticipantIds: [participantId("architect"), participantId("ui")],
  }));
  assert.deepEqual(
    result?.selections.map((selection) => selection.participantId),
    [participantId("architect"), participantId("ui")],
  );
  assert.ok(result?.selections.every((selection) =>
    selection.reasonCode === "direct_mention"
  ));
});

test("bounds and no eligible participant resolve to deterministic terminal decisions", () => {
  assert.equal(
    deterministicSchedulerDecision(input({ remainingMessageBudget: 0 }))
      ?.diagnosticCategory,
    "bound_reached",
  );
  assert.equal(
    deterministicSchedulerDecision(input({
      failedParticipantIds: [
        participantId("architect"),
        participantId("ui"),
        participantId("implementer"),
      ],
    }))?.diagnosticCategory,
    "no_eligible_participant",
  );
});

test("structured scheduler output supports one and N speakers after a human message", () => {
  const base = input();
  const one = parseSchedulerDecision(JSON.stringify({
    selections: [{
      participantId: "implementer",
      replyToMessageIds: ["message-user-1"],
      reasonCode: "owns_implementation",
    }],
    diagnosticCategory: "handoff",
  }), base);
  assert.deepEqual(one.selections.map((selection) => selection.participantId), [
    participantId("implementer"),
  ]);

  const multiple = parseSchedulerDecision(JSON.stringify({
    selections: [
      {
        participantId: "architect",
        replyToMessageIds: ["message-user-1"],
        reasonCode: "architecture_needed",
      },
      {
        participantId: "ui",
        replyToMessageIds: ["message-user-1"],
        reasonCode: "ui_guidance_needed",
      },
    ],
    diagnosticCategory: "parallel_specialists",
  }), base);
  assert.equal(multiple.selections.length, 2);
  assert.deepEqual(multiple.selections[0].replyToMessageIds, [
    messageId("message-user-1"),
  ]);
});

test("a human-opened floor requires one speaker while later waves may converge", () => {
  assert.equal(humanOpenedFloor(input()), true);
  assert.throws(() => parseSchedulerDecision(
    '{"selections":[],"diagnosticCategory":"nothing_substantive"}',
    input(),
  ), /HUMAN_FLOOR_UNANSWERED/);

  const assistantFrontier = messageId("assistant-wave-1");
  const laterWave = input({
    wave: 2,
    frontierMessageIds: [assistantFrontier],
    recentMessages: [{
      id: assistantFrontier,
      role: "assistant",
      participantId: participantId("architect"),
      speaker: "Architect",
      content: "The work is complete.",
    }],
  });
  assert.equal(humanOpenedFloor(laterWave), false);
  assert.equal(parseSchedulerDecision(
    '{"selections":[],"diagnosticCategory":"nothing_substantive"}',
    laterWave,
  ).selections.length, 0);
});

test("scheduler rejects stale IDs, failed speakers, and budget overflow", () => {
  assert.throws(() => parseSchedulerDecision(JSON.stringify({
    selections: [{ participantId: "outsider", replyToMessageIds: [] }],
  }), input()), /INELIGIBLE_SELECTION/);
  assert.throws(() => parseSchedulerDecision(JSON.stringify({
    selections: [{ participantId: "architect", replyToMessageIds: [] }],
  }), input({ failedParticipantIds: [participantId("architect")] })), /INELIGIBLE_SELECTION/);
  assert.throws(() => parseSchedulerDecision(JSON.stringify({
    selections: [
      { participantId: "architect", replyToMessageIds: [] },
      { participantId: "ui", replyToMessageIds: [] },
    ],
  }), input({ remainingMessageBudget: 1 })), /MESSAGE_BOUND_EXCEEDED/);
});

test("scheduler prompt carries role summaries and quiet-by-default policy", () => {
  const prompt = buildSchedulerPrompt(input({
    previousSpeakerIds: [participantId("architect")],
  }));
  assert.match(prompt, /quiet-by-default/);
  assert.match(prompt, /Own architecture and consequential review/);
  assert.match(prompt, /spokeInPreviousWave/);
  assert.match(prompt, /select at least one available participant/);
  assert.match(prompt, /must return at least one selection/);
  assert.match(prompt, /Never select a previous-wave speaker merely to reply/);
  assert.match(prompt, /Silence is the normal successful result/);
  assert.match(prompt, /never invent a specialty/);
  assert.match(prompt, /casual wellbeing message/);
});

test("scheduler suppresses a previous speaker continuing only its own reply", () => {
  const ownReply = messageId("architect-wave-1");
  const result = parseSchedulerDecision(JSON.stringify({
    selections: [{
      participantId: "architect",
      replyToMessageIds: ["architect-wave-1"],
      reasonCode: "continue_advice",
    }],
    diagnosticCategory: "follow_up",
  }), input({
    wave: 2,
    frontierMessageIds: [ownReply],
    previousSpeakerIds: [participantId("architect")],
    recentMessages: [{
      id: ownReply,
      role: "assistant",
      participantId: participantId("architect"),
      speaker: "Architect",
      content: "Here is my recommendation.",
    }],
  }));

  assert.equal(result.selections.length, 0);
  assert.equal(
    result.diagnosticCategory,
    "repetitive_self_continuation_suppressed",
  );
});

test("scheduler permits a previous speaker reacting to another participant", () => {
  const uiReply = messageId("ui-wave-1");
  const result = parseSchedulerDecision(JSON.stringify({
    selections: [{
      participantId: "architect",
      replyToMessageIds: ["ui-wave-1"],
      reasonCode: "review_ui_change",
    }],
    diagnosticCategory: "review_handoff",
  }), input({
    wave: 2,
    frontierMessageIds: [uiReply],
    previousSpeakerIds: [participantId("architect")],
    recentMessages: [{
      id: uiReply,
      role: "assistant",
      participantId: participantId("ui"),
      speaker: "UI expert",
      content: "I changed the layout hierarchy.",
    }],
  }));

  assert.deepEqual(result.selections.map((selection) => selection.participantId), [
    participantId("architect"),
  ]);
});

test("malformed or truncated scheduler output becomes an explicit scheduler error", () => {
  const malformed = parseSchedulerDecisionOrSilence(
    '{"selections":[{"participantId":"architect","reasonCode":"unfinished',
    input(),
    "length",
  );
  assert.equal(malformed.selections.length, 0);
  assert.equal(malformed.diagnosticCategory, "scheduler_output_truncated");

  const invalid = parseSchedulerDecisionOrSilence("not json", input(), "stop");
  assert.equal(invalid.selections.length, 0);
  assert.equal(invalid.diagnosticCategory, "scheduler_invalid_response");
});

test("scheduler requests a strict schema bound to eligible participants and frontier", () => {
  const format = schedulerResponseFormat(input({
    failedParticipantIds: [participantId("ui")],
    remainingMessageBudget: 2,
  }));
  const schema = format.json_schema.schema as {
    properties: {
      selections: {
        minItems: number;
        maxItems: number;
        items: { properties: { participantId: { enum: string[] } } };
      };
    };
  };
  assert.equal(format.json_schema.strict, true);
  assert.equal(schema.properties.selections.minItems, 1);
  assert.equal(schema.properties.selections.maxItems, 2);
  assert.deepEqual(
    schema.properties.selections.items.properties.participantId.enum,
    ["architect", "implementer"],
  );

  const assistantFrontier = messageId("assistant-wave-1");
  const laterFormat = schedulerResponseFormat(input({
    wave: 2,
    frontierMessageIds: [assistantFrontier],
    recentMessages: [{
      id: assistantFrontier,
      role: "assistant",
      participantId: participantId("architect"),
      speaker: "Architect",
      content: "Done.",
    }],
  }));
  const laterSchema = laterFormat.json_schema.schema as {
    properties: { selections: { minItems: number } };
  };
  assert.equal(laterSchema.properties.selections.minItems, 0);
});
