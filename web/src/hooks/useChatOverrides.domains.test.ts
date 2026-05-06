import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  useChatPanelState,
  useKnowledgeBaseSelection,
  useTurnOverrideState,
} from "@/hooks/useChatOverrides.domains";

describe("useChatOverrides domain hooks", () => {
  it("tracks ephemeral turn overrides and serialized send entries", () => {
    const { result } = renderHook(() => useTurnOverrideState());

    act(() => {
      result.current.addTurnSkillOverride("skill_1", "always");
      result.current.addTurnIntegrationOverride("drive", true);
    });

    expect(result.current.turnSkillOverrides.get("skill_1")).toBe("always");
    expect(result.current.turnIntegrationOverrides.get("drive")).toBe(true);
    expect(result.current.turnSkillOverrideEntries).toEqual([{ skillId: "skill_1", state: "always" }]);
    expect(result.current.turnIntegrationOverrideEntries).toEqual([{ integrationId: "drive", enabled: true }]);

    act(() => result.current.clearTurnOverrides());

    expect(result.current.turnSkillOverrides.size).toBe(0);
    expect(result.current.turnIntegrationOverrides.size).toBe(0);
  });

  it("toggles and clears KB selection independently", () => {
    const { result } = renderHook(() => useKnowledgeBaseSelection());

    act(() => {
      result.current.toggleKBFile("storage_1");
      result.current.toggleKBFile("storage_2");
      result.current.toggleKBFile("storage_1");
    });

    expect(Array.from(result.current.selectedKBFileIds)).toEqual(["storage_2"]);

    act(() => result.current.clearKBFiles());

    expect(result.current.selectedKBFileIds.size).toBe(0);
  });

  it("opens only panel-backed plus menu items", () => {
    const { result } = renderHook(() => useChatPanelState());

    act(() => result.current.handlePlusMenuSelect("file"));
    expect(result.current.activePanel).toBeNull();

    act(() => result.current.handlePlusMenuSelect("skills"));
    expect(result.current.activePanel).toBe("skills");

    act(() => result.current.closePanel());
    expect(result.current.activePanel).toBeNull();
  });
});
