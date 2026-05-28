import { describe, expect, it } from "vitest";
import {
  cloneSkillMetadataSelection,
  emptySkillMetadataSelection,
  inferredRuntimeMode,
  inferSkillMetadataSelection,
  requiredCapabilitiesForSkill,
  requiredToolProfilesForSkill,
  skillMetadataSelectionFromSkill,
  skillSelectionEquals,
} from "./SkillMetadataSelection";

describe("SkillMetadataSelection", () => {
  it("maps selected tools and integrations into sorted backend metadata", () => {
    const selection = {
      usesCodingWorkspace: true,
      usesDataAnalysis: true,
      usesDocuments: true,
      selectedIntegrationIds: new Set(["slack", "gmail", "onedrive", "apple_calendar"]),
    };

    expect(requiredToolProfilesForSkill(selection)).toEqual([
      "analytics",
      "appleCalendar",
      "docs",
      "google",
      "microsoft",
      "slack",
      "workspace",
    ]);
    expect(requiredCapabilitiesForSkill(selection)).toEqual([]);
    expect(inferredRuntimeMode(selection)).toBe("sandboxAugmented");
  });

  it("infers metadata from natural-language skill descriptions without marking data analysis as coding workspace", () => {
    const selection = inferSkillMetadataSelection(
      "Analyze CSV exports from Gmail",
      "Use pandas to inspect the spreadsheet, then produce a DOCX summary.",
    );

    expect(selection.usesDocuments).toBe(true);
    expect(selection.usesDataAnalysis).toBe(true);
    expect(selection.usesCodingWorkspace).toBe(false);
    expect(selection.selectedIntegrationIds.has("gmail")).toBe(true);
    expect(requiredToolProfilesForSkill(selection)).toEqual(["analytics", "docs", "google"]);
    expect(inferredRuntimeMode(selection)).toBe("sandboxAugmented");
  });

  it("infers coding workspace for shell-oriented skills and tool mode for document-only skills", () => {
    const workspaceSelection = inferSkillMetadataSelection("Run terminal checks", "Use workspace_exec and bash.");
    const documentSelection = inferSkillMetadataSelection("Prepare presentation", "Create a pptx deck.");

    expect(workspaceSelection.usesCodingWorkspace).toBe(true);
    expect(workspaceSelection.usesDataAnalysis).toBe(false);
    expect(inferredRuntimeMode(workspaceSelection)).toBe("sandboxAugmented");
    expect(documentSelection.usesDocuments).toBe(true);
    expect(inferredRuntimeMode(documentSelection)).toBe("toolAugmented");
    expect(inferredRuntimeMode(emptySkillMetadataSelection())).toBe("textOnly");
  });

  it("clones, compares, and hydrates selections from existing skills", () => {
    const selection = skillMetadataSelectionFromSkill({
      requiredToolProfiles: ["docs", "workspace"],
      requiredIntegrationIds: ["drive"],
      requiredCapabilities: ["future_capability"],
    });
    const clone = cloneSkillMetadataSelection(selection);

    expect(clone).not.toBe(selection);
    expect(clone.selectedIntegrationIds).not.toBe(selection.selectedIntegrationIds);
    expect(skillSelectionEquals(selection, clone)).toBe(true);

    clone.selectedIntegrationIds.add("slack");
    expect(skillSelectionEquals(selection, clone)).toBe(false);
  });
});
