import { describe, expect, it } from "vitest";
import {
  isIntegrationOffered,
  isSlackIntegrationAvailable,
  shouldShowSlackConnectionRow,
} from "./integrationAvailability";
import { inferSkillMetadataSelection, OFFERED_SKILL_INTEGRATION_OPTIONS } from "@/routes/SkillMetadataSelection";

describe("integrationAvailability", () => {
  it("keeps Slack unavailable for new connections", () => {
    expect(isSlackIntegrationAvailable).toBe(false);
    expect(isIntegrationOffered("slack")).toBe(false);
    expect(isIntegrationOffered("notion")).toBe(true);
  });

  it("only shows the Slack settings row for an existing connection", () => {
    expect(shouldShowSlackConnectionRow(false)).toBe(false);
    expect(shouldShowSlackConnectionRow(true)).toBe(true);
  });

  it("does not offer or infer Slack in skill metadata", () => {
    expect(OFFERED_SKILL_INTEGRATION_OPTIONS.map((option) => option.id)).not.toContain("slack");
    const inferred = inferSkillMetadataSelection("Slack digest", "Summarize Slack and Notion updates.");
    expect(inferred.selectedIntegrationIds.has("slack")).toBe(false);
    expect(inferred.selectedIntegrationIds.has("notion")).toBe(true);
  });
});
