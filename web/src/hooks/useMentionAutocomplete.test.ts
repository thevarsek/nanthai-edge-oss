import { describe, expect, it } from "vitest";

import {
  mentionedParticipantKeys,
  type MentionSuggestion,
} from "./useMentionAutocomplete";

const suggestions: MentionSuggestion[] = [
  {
    participantKey: "participant_1",
    displayName: "Research Lead",
    subtitle: "gpt-5.2",
    isPersona: true,
    modelId: "openai/gpt-5.2",
  },
  {
    participantKey: "participant_2",
    displayName: "claude-sonnet-4",
    subtitle: "anthropic",
    isPersona: false,
    modelId: "anthropic/claude-sonnet-4",
  },
];

describe("mentionedParticipantKeys", () => {
  it("targets one or multiple exact mention tokens in participant order", () => {
    expect(mentionedParticipantKeys("@Research_Lead review this", suggestions)).toEqual([
      "participant_1",
    ]);
    expect(mentionedParticipantKeys(
      "@claude-sonnet-4 compare with @Research_Lead",
      suggestions,
    )).toEqual(["participant_1", "participant_2"]);
  });

  it("recognizes mentions followed by punctuation", () => {
    expect(mentionedParticipantKeys("@Research_Lead, review this", suggestions)).toEqual([
      "participant_1",
    ]);
  });

  it("keeps all-participant behavior by returning no keys without a valid mention", () => {
    expect(mentionedParticipantKeys("Everyone review this", suggestions)).toEqual([]);
    expect(mentionedParticipantKeys("email@Research_Lead.example", suggestions)).toEqual([]);
    expect(mentionedParticipantKeys("@Unknown review this", suggestions)).toEqual([]);
  });
});
