import { useCallback, useMemo, useState } from "react";
import type { PlusMenuItem } from "@/components/chat/ChatPlusMenu";
import type { ChatPanel } from "@/hooks/useChatOverrides";
import type { SkillOverrideState } from "@/hooks/useChatOverrides.resolution";
import {
  serializeIntegrationOverrideEntries,
  serializeSkillOverrideEntries,
} from "@/hooks/useChatOverrides.state";

export function useTurnOverrideState() {
  const [turnSkillOverrides, setTurnSkillOverrides] = useState<Map<string, SkillOverrideState>>(new Map());
  const [turnIntegrationOverrides, setTurnIntegrationOverrides] = useState<Map<string, boolean>>(new Map());

  const addTurnSkillOverride = useCallback((skillId: string, state: SkillOverrideState) => {
    setTurnSkillOverrides((prev) => new Map(prev).set(skillId, state));
  }, []);

  const removeTurnSkillOverride = useCallback((skillId: string) => {
    setTurnSkillOverrides((prev) => {
      const next = new Map(prev);
      next.delete(skillId);
      return next;
    });
  }, []);

  const addTurnIntegrationOverride = useCallback((integrationKey: string, enabled: boolean) => {
    setTurnIntegrationOverrides((prev) => new Map(prev).set(integrationKey, enabled));
  }, []);

  const removeTurnIntegrationOverride = useCallback((integrationKey: string) => {
    setTurnIntegrationOverrides((prev) => {
      const next = new Map(prev);
      next.delete(integrationKey);
      return next;
    });
  }, []);

  const clearTurnOverrides = useCallback(() => {
    setTurnSkillOverrides(new Map());
    setTurnIntegrationOverrides(new Map());
  }, []);

  const turnSkillOverrideEntries = useMemo(
    () => serializeSkillOverrideEntries(turnSkillOverrides),
    [turnSkillOverrides],
  );

  const turnIntegrationOverrideEntries = useMemo(
    () => serializeIntegrationOverrideEntries(turnIntegrationOverrides),
    [turnIntegrationOverrides],
  );

  return {
    turnSkillOverrides,
    turnIntegrationOverrides,
    turnSkillOverrideEntries,
    turnIntegrationOverrideEntries,
    addTurnSkillOverride,
    removeTurnSkillOverride,
    addTurnIntegrationOverride,
    removeTurnIntegrationOverride,
    clearTurnOverrides,
  };
}

export function useKnowledgeBaseSelection() {
  const [selectedKBFileIds, setSelectedKBFileIds] = useState<Set<string>>(new Set());

  const toggleKBFile = useCallback((storageId: string) => {
    setSelectedKBFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(storageId)) next.delete(storageId);
      else next.add(storageId);
      return next;
    });
  }, []);

  const clearKBFiles = useCallback(() => {
    setSelectedKBFileIds(new Set());
  }, []);

  return {
    selectedKBFileIds,
    toggleKBFile,
    clearKBFiles,
  };
}

export function useChatPanelState() {
  const [activePanel, setActivePanel] = useState<ChatPanel>(null);

  const handlePlusMenuSelect = useCallback((item: PlusMenuItem) => {
    switch (item) {
      case "parameters":
      case "integrations":
      case "skills":
      case "knowledgeBase":
      case "participants":
      case "subagents":
      case "autonomous":
        setActivePanel(item);
        break;
      case "file":
      case "image":
        break;
    }
  }, []);

  const closePanel = useCallback(() => setActivePanel(null), []);

  return {
    activePanel,
    setActivePanel,
    closePanel,
    handlePlusMenuSelect,
  };
}
