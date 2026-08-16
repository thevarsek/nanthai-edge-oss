import {
  humanOpenedFloor,
  type SchedulerPolicyInput,
} from "./scheduler_policy";

export function schedulerResponseFormat(input: SchedulerPolicyInput) {
  const eligibleParticipantIds = input.participants
    .filter((participant) => !input.failedParticipantIds.includes(
      participant.participantId,
    ))
    .map((participant) => String(participant.participantId));
  return {
    type: "json_schema" as const,
    json_schema: {
      name: "nanthai_collaboration_scheduler",
      strict: true,
      schema: {
        type: "object",
        properties: {
          selections: {
            type: "array",
            minItems: humanOpenedFloor(input) ? 1 : 0,
            maxItems: input.remainingMessageBudget,
            items: {
              type: "object",
              properties: {
                participantId: {
                  type: "string",
                  enum: eligibleParticipantIds,
                },
                replyToMessageIds: {
                  type: "array",
                  items: {
                    type: "string",
                    enum: input.frontierMessageIds.map(String),
                  },
                },
                reasonCode: { type: "string" },
              },
              required: ["participantId", "replyToMessageIds", "reasonCode"],
              additionalProperties: false,
            },
          },
          diagnosticCategory: { type: "string" },
        },
        required: ["selections", "diagnosticCategory"],
        additionalProperties: false,
      },
    },
  };
}
