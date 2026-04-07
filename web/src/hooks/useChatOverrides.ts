// hooks/useChatOverrides.ts
// Manages per-chat override state: parameter overrides, enabled integrations,
// enabled skills, and KB file selections.
// Extracted from ChatPage to keep it under 300 lines.

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ChatParameterOverrides } from "@/components/chat/ChatParametersDrawer";
import type { IntegrationKey } from "@/routes/PersonaEditorForm";
import type { PlusMenuItem } from "@/components/chat/ChatPlusMenu";
import type { Chat, UseChatReturn } from "@/hooks/useChat";

// ─── Default parameter overrides ────────────────────────────────────────────

export const DEFAULT_OVERRIDES: ChatParameterOverrides = {
  temperatureMode: "default",
  temperature: 1.0,
  maxTokensMode: "default",
  maxTokens: undefined,
  reasoningMode: "default",
  reasoningEffort: "medium",
  autoAudioResponseMode: "default",
};

// ─── Active panel type ──────────────────────────────────────────────────────

export type ChatPanel =
  | "parameters"
  | "integrations"
  | "skills"
  | "knowledgeBase"
  | "participants"
  | "subagents"
  | "autonomous"
  | null;

interface SkillPersonaSource {
  discoverableSkillIds?: string[] | null;
}

interface UseChatOverridesArgs {
  chat: Chat | null | undefined;
  chatId: Id<"chats"> | undefined;
  activePersona: SkillPersonaSource | null;
  updateChat: UseChatReturn["updateChat"];
}

function setEquals(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function chatOverridesFromChat(chat: Chat | null | undefined): ChatParameterOverrides {
  return {
    temperatureMode: chat?.temperatureOverride == null ? "default" : "override",
    temperature: chat?.temperatureOverride ?? DEFAULT_OVERRIDES.temperature,
    maxTokensMode: chat?.maxTokensOverride == null ? "default" : "override",
    maxTokens: chat?.maxTokensOverride ?? undefined,
    reasoningMode:
      chat?.includeReasoningOverride == null
        ? "default"
        : chat.includeReasoningOverride
          ? "on"
          : "off",
    reasoningEffort: (chat?.reasoningEffortOverride as ChatParameterOverrides["reasoningEffort"] | undefined)
      ?? DEFAULT_OVERRIDES.reasoningEffort,
    autoAudioResponseMode:
      chat?.autoAudioResponseOverride == null
        ? "default"
        : chat.autoAudioResponseOverride === "enabled"
          ? "on"
          : "off",
  };
}

function enabledSkillIdsFromChat(
  chat: Chat | null | undefined,
  personaDefaults: Set<string>,
): Set<string> {
  const next = new Set(personaDefaults);
  for (const id of chat?.discoverableSkillIds ?? []) next.add(id);
  for (const id of chat?.disabledSkillIds ?? []) next.delete(id);
  return next;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useChatOverrides({
  chat,
  chatId,
  activePersona,
  updateChat,
}: UseChatOverridesArgs) {
  const setChatSkills = useMutation(api.skills.mutations.setChatSkillsPublic);
  const [draftParamOverrides, setDraftParamOverrides] = useState<ChatParameterOverrides>(DEFAULT_OVERRIDES);
  const [pendingParamOverrides, setPendingParamOverrides] = useState<ChatParameterOverrides | null>(null);
  const [enabledIntegrations, setEnabledIntegrations] = useState<Set<IntegrationKey>>(new Set());
  const [draftEnabledSkillIds, setDraftEnabledSkillIds] = useState<Set<string>>(new Set());
  const [pendingEnabledSkillIds, setPendingEnabledSkillIds] = useState<Set<string> | null>(null);
  const [selectedKBFileIds, setSelectedKBFileIds] = useState<Set<string>>(new Set());
  const [activePanel, setActivePanel] = useState<ChatPanel>(null);
  const draftParamDirtyRef = useRef(false);
  const draftSkillDirtyRef = useRef(false);

  const personaDefaultSkillIds = useMemo(
    () => new Set(activePersona?.discoverableSkillIds ?? []),
    [activePersona],
  );

  const resolvedParamOverrides = useMemo(
    () => chatOverridesFromChat(chat),
    [chat],
  );

  const resolvedEnabledSkillIds = useMemo(
    () => enabledSkillIdsFromChat(chat, personaDefaultSkillIds),
    [chat, personaDefaultSkillIds],
  );

  useEffect(() => {
    if (chatId || draftSkillDirtyRef.current) return;
    setDraftEnabledSkillIds(new Set(personaDefaultSkillIds));
  }, [chatId, personaDefaultSkillIds]);

  useEffect(() => {
    if (pendingParamOverrides && JSON.stringify(pendingParamOverrides) === JSON.stringify(resolvedParamOverrides)) {
      setPendingParamOverrides(null);
    }
  }, [pendingParamOverrides, resolvedParamOverrides]);

  useEffect(() => {
    if (pendingEnabledSkillIds && setEquals(pendingEnabledSkillIds, resolvedEnabledSkillIds)) {
      setPendingEnabledSkillIds(null);
    }
  }, [pendingEnabledSkillIds, resolvedEnabledSkillIds]);

  const paramOverrides = chatId
    ? pendingParamOverrides ?? resolvedParamOverrides
    : draftParamOverrides;

  const enabledSkillIds = chatId
    ? pendingEnabledSkillIds ?? resolvedEnabledSkillIds
    : draftEnabledSkillIds;

  const persistParamOverrides = useCallback(
    async (targetChatId: Id<"chats">, overrides: ChatParameterOverrides) => {
      await updateChat({
        chatId: targetChatId,
        temperatureOverride: overrides.temperatureMode === "override" ? overrides.temperature : null,
        maxTokensOverride: overrides.maxTokensMode === "override" ? overrides.maxTokens ?? null : null,
        includeReasoningOverride:
          overrides.reasoningMode === "default"
            ? null
            : overrides.reasoningMode === "on",
        reasoningEffortOverride:
          overrides.reasoningMode === "on"
            ? overrides.reasoningEffort
            : null,
        autoAudioResponseOverride:
          overrides.autoAudioResponseMode === "default"
            ? null
            : overrides.autoAudioResponseMode === "on"
              ? "enabled"
              : "disabled",
      } as Parameters<typeof updateChat>[0]);
    },
    [updateChat],
  );

  const persistSkillOverrides = useCallback(
    async (targetChatId: Id<"chats">, nextEnabledSkillIds: Set<string>) => {
      const discoverableSkillIds = Array.from(nextEnabledSkillIds).filter((id) => !personaDefaultSkillIds.has(id));
      const disabledSkillIds = Array.from(personaDefaultSkillIds).filter((id) => !nextEnabledSkillIds.has(id));
      await setChatSkills({
        chatId: targetChatId,
        discoverableSkillIds: discoverableSkillIds as Id<"skills">[],
        disabledSkillIds: disabledSkillIds as Id<"skills">[],
      });
    },
    [personaDefaultSkillIds, setChatSkills],
  );

  const setParamOverrides = useCallback(
    (nextOverrides: ChatParameterOverrides) => {
      if (!chatId) {
        draftParamDirtyRef.current = true;
        setDraftParamOverrides(nextOverrides);
        return;
      }
      setPendingParamOverrides(nextOverrides);
      void persistParamOverrides(chatId, nextOverrides).catch((err) => {
        console.error("[useChatOverrides] persistParamOverrides failed:", err);
        setPendingParamOverrides(null);
      });
    },
    [chatId, persistParamOverrides],
  );

  const toggleIntegration = useCallback((key: IntegrationKey) => {
    setEnabledIntegrations((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleSkill = useCallback((skillId: Id<"skills">) => {
    const applyToggle = (current: Set<string>) => {
      const next = new Set(current);
      const id = skillId as string;
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    };

    if (!chatId) {
      draftSkillDirtyRef.current = true;
      setDraftEnabledSkillIds((prev) => applyToggle(prev));
      return;
    }

    const next = applyToggle(enabledSkillIds);
    setPendingEnabledSkillIds(next);
    void persistSkillOverrides(chatId, next).catch((err) => {
      console.error("[useChatOverrides] persistSkillOverrides failed:", err);
      setPendingEnabledSkillIds(null);
    });
  }, [chatId, enabledSkillIds, persistSkillOverrides]);

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

  const handlePlusMenuSelect = useCallback((item: PlusMenuItem) => {
    switch (item) {
      case "parameters":
        setActivePanel("parameters");
        break;
      case "integrations":
        setActivePanel("integrations");
        break;
      case "skills":
        setActivePanel("skills");
        break;
      case "knowledgeBase":
        setActivePanel("knowledgeBase");
        break;
      case "participants":
        setActivePanel("participants");
        break;
      case "subagents":
        setActivePanel("subagents");
        break;
      case "autonomous":
        setActivePanel("autonomous");
        break;
      // "file", "image" handled by MessageInput / ChatPage
    }
  }, []);

  const closePanel = useCallback(() => setActivePanel(null), []);

  // Badge counts for the plus menu
  const badges = useMemo(() => {
    const hasParamOverride =
      paramOverrides.temperatureMode === "override" ||
      paramOverrides.maxTokensMode === "override" ||
      paramOverrides.reasoningMode !== "default";
    return {
      parameters: hasParamOverride ? 1 : 0,
      integrations: enabledIntegrations.size,
      skills: enabledSkillIds.size,
      knowledgeBase: selectedKBFileIds.size,
    } as Partial<Record<PlusMenuItem, number>>;
  }, [paramOverrides, enabledIntegrations, enabledSkillIds, selectedKBFileIds]);

  const flushPendingState = useCallback(
    async (targetChatId: Id<"chats">) => {
      if (!chatId) {
        if (draftParamDirtyRef.current) {
          await persistParamOverrides(targetChatId, draftParamOverrides);
        }
        if (draftSkillDirtyRef.current) {
          await persistSkillOverrides(targetChatId, draftEnabledSkillIds);
        }
        return;
      }

      if (pendingParamOverrides) {
        await persistParamOverrides(targetChatId, pendingParamOverrides);
      }
      if (pendingEnabledSkillIds) {
        await persistSkillOverrides(targetChatId, pendingEnabledSkillIds);
      }
    },
    [
      chatId,
      draftEnabledSkillIds,
      draftParamOverrides,
      pendingEnabledSkillIds,
      pendingParamOverrides,
      persistParamOverrides,
      persistSkillOverrides,
    ],
  );

  return {
    paramOverrides,
    setParamOverrides,
    enabledIntegrations,
    toggleIntegration,
    enabledSkillIds,
    toggleSkill,
    selectedKBFileIds,
    toggleKBFile,
    clearKBFiles,
    activePanel,
    setActivePanel,
    closePanel,
    handlePlusMenuSelect,
    badges,
    flushPendingState,
  };
}
