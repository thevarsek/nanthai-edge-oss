// hooks/useChatOverrides.ts
// Manages per-chat override state: parameter overrides, skill overrides (M30 tri-state),
// integration overrides (M30 persisted), KB file selections, and turn overrides.

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ChatParameterOverrides } from "@/components/chat/ChatParametersDrawer";
import type { IntegrationKey } from "@/routes/PersonaEditorForm";
import type { Chat, UseChatReturn } from "@/hooks/useChat";
import {
  useChatPanelState,
  useKnowledgeBaseSelection,
  useTurnOverrideState,
} from "@/hooks/useChatOverrides.domains";
import {
  buildOverrideBadges,
  chatOverridesFromChat,
  DEFAULT_OVERRIDES,
  enabledIntegrationKeysFromOverrides,
  enabledSkillIdsFromOverrides,
  integrationOverridesFromChat,
  personaIntegrationDefaults,
  personaSkillDefaults,
  skillOverridesFromChat,
  type SkillPersonaSource,
  type SkillOverrideState,
} from "@/hooks/useChatOverrides.resolution";
import {
  buildFlushPlan,
  nextCycledSkillOverrides,
  nextToggledIntegrationOverrides,
  nextToggledSkillOverrides,
  pendingMapConverged,
  pendingParamOverridesConverged,
  serializeIntegrationOverrideEntries,
  serializeSkillOverrideEntries,
} from "@/hooks/useChatOverrides.state";

// ─── M30 types ──────────────────────────────────────────────────────────────

export type { SkillOverrideState } from "@/hooks/useChatOverrides.resolution";

export interface SkillOverrideEntry {
  skillId: Id<"skills">;
  state: SkillOverrideState;
}

export interface IntegrationOverrideEntry {
  integrationId: string;
  enabled: boolean;
}

export { DEFAULT_OVERRIDES } from "@/hooks/useChatOverrides.resolution";

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

interface UseChatOverridesArgs {
  chat: Chat | null | undefined;
  chatId: Id<"chats"> | undefined;
  activePersona: SkillPersonaSource | null;
  updateChat: UseChatReturn["updateChat"];
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useChatOverrides({
  chat,
  chatId,
  activePersona,
  updateChat,
}: UseChatOverridesArgs) {
  const setChatSkillOverrides = useMutation(api.skills.mutations.setChatSkillOverrides);
  const setChatIntegrationOverrides = useMutation(api.skills.mutations.setChatIntegrationOverrides);

  const [draftParamOverrides, setDraftParamOverrides] = useState<ChatParameterOverrides>(DEFAULT_OVERRIDES);
  const [pendingParamOverrides, setPendingParamOverrides] = useState<ChatParameterOverrides | null>(null);
  const [draftSkillOverrides, setDraftSkillOverrides] = useState<Map<string, SkillOverrideState>>(new Map());
  const [pendingSkillOverrides, setPendingSkillOverrides] = useState<Map<string, SkillOverrideState> | null>(null);
  const [draftIntegrationOverrides, setDraftIntegrationOverrides] = useState<Map<string, boolean>>(new Map());
  const [pendingIntegrationOverrides, setPendingIntegrationOverrides] = useState<Map<string, boolean> | null>(null);
  const turnOverrides = useTurnOverrideState();
  const knowledgeBaseSelection = useKnowledgeBaseSelection();
  const panelState = useChatPanelState();
  const draftParamDirtyRef = useRef(false);
  const draftSkillDirtyRef = useRef(false);
  const draftIntegrationDirtyRef = useRef(false);

  // ── Persona defaults ────────────────────────────────────────────────────

  const personaSkillDefaultsMap = useMemo(
    () => personaSkillDefaults(activePersona),
    [activePersona],
  );

  const personaIntegrationDefaultsMap = useMemo(
    () => personaIntegrationDefaults(activePersona),
    [activePersona],
  );

  // ── Resolved from chat (server state) ───────────────────────────────────

  const resolvedParamOverrides = useMemo(
    () => chatOverridesFromChat(chat),
    [chat],
  );

  const resolvedSkillOverrides = useMemo(
    () => skillOverridesFromChat(chat, personaSkillDefaultsMap),
    [chat, personaSkillDefaultsMap],
  );

  const resolvedIntegrationOverrides = useMemo(
    () => integrationOverridesFromChat(chat, personaIntegrationDefaultsMap),
    [chat, personaIntegrationDefaultsMap],
  );

  // ── Sync draft state for new chats (no chatId yet) ──────────────────────

  useEffect(() => {
    if (chatId || draftSkillDirtyRef.current) return;
    // New-chat draft state intentionally follows persona defaults until the user edits it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraftSkillOverrides(new Map(personaSkillDefaultsMap));
  }, [chatId, personaSkillDefaultsMap]);

  useEffect(() => {
    if (chatId || draftIntegrationDirtyRef.current) return;
    // New-chat draft state intentionally follows persona defaults until the user edits it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraftIntegrationOverrides(new Map(personaIntegrationDefaultsMap));
  }, [chatId, personaIntegrationDefaultsMap]);

  // ── Pending → resolved convergence ──────────────────────────────────────

  useEffect(() => {
    if (pendingParamOverridesConverged(pendingParamOverrides, resolvedParamOverrides)) {
      // Drop optimistic state once Convex reflects the same parameter overrides.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPendingParamOverrides(null);
    }
  }, [pendingParamOverrides, resolvedParamOverrides]);

  useEffect(() => {
    if (pendingMapConverged(pendingSkillOverrides, resolvedSkillOverrides)) {
      // Drop optimistic state once Convex reflects the same skill overrides.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPendingSkillOverrides(null);
    }
  }, [pendingSkillOverrides, resolvedSkillOverrides]);

  useEffect(() => {
    if (pendingMapConverged(pendingIntegrationOverrides, resolvedIntegrationOverrides)) {
      // Drop optimistic state once Convex reflects the same integration overrides.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPendingIntegrationOverrides(null);
    }
  }, [pendingIntegrationOverrides, resolvedIntegrationOverrides]);

  // ── Current effective state (optimistic) ────────────────────────────────

  const paramOverrides = chatId
    ? pendingParamOverrides ?? resolvedParamOverrides
    : draftParamOverrides;

  const skillOverrides = chatId
    ? pendingSkillOverrides ?? resolvedSkillOverrides
    : draftSkillOverrides;

  const integrationOverrides = chatId
    ? pendingIntegrationOverrides ?? resolvedIntegrationOverrides
    : draftIntegrationOverrides;

  // Derived: backward-compat sets for consumers that still use Set<string>
  const enabledSkillIds = useMemo(
    () => enabledSkillIdsFromOverrides(skillOverrides),
    [skillOverrides],
  );

  const enabledIntegrations = useMemo(
    () => enabledIntegrationKeysFromOverrides(integrationOverrides),
    [integrationOverrides],
  );

  // ── Persist functions ───────────────────────────────────────────────────

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
    async (targetChatId: Id<"chats">, next: Map<string, SkillOverrideState>) => {
      // M30 path
      await setChatSkillOverrides({
        chatId: targetChatId,
        skillOverrides: serializeSkillOverrideEntries(next),
      });
    },
    [setChatSkillOverrides],
  );

  const persistIntegrationOverrides = useCallback(
    async (targetChatId: Id<"chats">, next: Map<string, boolean>) => {
      await setChatIntegrationOverrides({
        chatId: targetChatId,
        integrationOverrides: serializeIntegrationOverrideEntries(next),
      });
    },
    [setChatIntegrationOverrides],
  );

  // ── User actions ──────────────────────────────────────────────────────────

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

  /** Cycle a skill's override state: inherited → always → available → never → inherited. */
  const cycleSkill = useCallback((skillId: Id<"skills">) => {
    const id = skillId as string;

    if (!chatId) {
      draftSkillDirtyRef.current = true;
      setDraftSkillOverrides((prev) => nextCycledSkillOverrides(prev, id));
      return;
    }

    const next = nextCycledSkillOverrides(skillOverrides, id);
    setPendingSkillOverrides(next);
    void persistSkillOverrides(chatId, next).catch((err) => {
      console.error("[useChatOverrides] persistSkillOverrides failed:", err);
      setPendingSkillOverrides(null);
    });
  }, [chatId, skillOverrides, persistSkillOverrides]);

  /** Binary toggle for legacy consumers. Toggles between available and never. */
  const toggleSkill = useCallback((skillId: Id<"skills">) => {
    const id = skillId as string;

    if (!chatId) {
      draftSkillDirtyRef.current = true;
      setDraftSkillOverrides((prev) => nextToggledSkillOverrides(prev, id));
      return;
    }

    const next = nextToggledSkillOverrides(skillOverrides, id);
    setPendingSkillOverrides(next);
    void persistSkillOverrides(chatId, next).catch((err) => {
      console.error("[useChatOverrides] persistSkillOverrides failed:", err);
      setPendingSkillOverrides(null);
    });
  }, [chatId, skillOverrides, persistSkillOverrides]);

  const toggleIntegration = useCallback((key: IntegrationKey) => {
    if (!chatId) {
      draftIntegrationDirtyRef.current = true;
      setDraftIntegrationOverrides((prev) => nextToggledIntegrationOverrides(prev, key));
      return;
    }

    const next = nextToggledIntegrationOverrides(integrationOverrides, key);
    setPendingIntegrationOverrides(next);
    void persistIntegrationOverrides(chatId, next).catch((err) => {
      console.error("[useChatOverrides] persistIntegrationOverrides failed:", err);
      setPendingIntegrationOverrides(null);
    });
  }, [chatId, integrationOverrides, persistIntegrationOverrides]);

  // ── Badge counts ──────────────────────────────────────────────────────────

  const badges = useMemo(
    () => buildOverrideBadges({
      paramOverrides,
      enabledIntegrations,
      enabledSkillIds,
      selectedKBFileIds: knowledgeBaseSelection.selectedKBFileIds,
    }),
    [paramOverrides, enabledIntegrations, enabledSkillIds, knowledgeBaseSelection.selectedKBFileIds],
  );

  // ── Flush pending state (on first send for new chats) ─────────────────────

  const flushPendingState = useCallback(
    async (targetChatId: Id<"chats">) => {
      const plan = buildFlushPlan({
        chatId,
        draftParamDirty: draftParamDirtyRef.current,
        draftSkillDirty: draftSkillDirtyRef.current,
        draftIntegrationDirty: draftIntegrationDirtyRef.current,
        pendingParamOverrides,
        pendingSkillOverrides,
        pendingIntegrationOverrides,
      });
      if (!chatId) {
        if (plan.parameters) await persistParamOverrides(targetChatId, draftParamOverrides);
        if (plan.skills) await persistSkillOverrides(targetChatId, draftSkillOverrides);
        if (plan.integrations) await persistIntegrationOverrides(targetChatId, draftIntegrationOverrides);
        return;
      }

      if (plan.parameters && pendingParamOverrides) {
        await persistParamOverrides(targetChatId, pendingParamOverrides);
      }
      if (plan.skills && pendingSkillOverrides) {
        await persistSkillOverrides(targetChatId, pendingSkillOverrides);
      }
      if (plan.integrations && pendingIntegrationOverrides) {
        await persistIntegrationOverrides(targetChatId, pendingIntegrationOverrides);
      }
    },
    [
      chatId,
      draftIntegrationOverrides,
      draftSkillOverrides,
      draftParamOverrides,
      pendingIntegrationOverrides,
      pendingSkillOverrides,
      pendingParamOverrides,
      persistIntegrationOverrides,
      persistParamOverrides,
      persistSkillOverrides,
    ],
  );

  return {
    // Parameters
    paramOverrides,
    setParamOverrides,
    // Skills (M30 tri-state)
    skillOverrides,
    cycleSkill,
    toggleSkill,
    enabledSkillIds, // derived, backward compat
    // Integrations (M30 persisted)
    integrationOverrides,
    enabledIntegrations, // derived, backward compat
    toggleIntegration,
    // Turn overrides
    turnSkillOverrides: turnOverrides.turnSkillOverrides,
    turnIntegrationOverrides: turnOverrides.turnIntegrationOverrides,
    turnSkillOverrideEntries: turnOverrides.turnSkillOverrideEntries,
    turnIntegrationOverrideEntries: turnOverrides.turnIntegrationOverrideEntries,
    addTurnSkillOverride: turnOverrides.addTurnSkillOverride,
    removeTurnSkillOverride: turnOverrides.removeTurnSkillOverride,
    addTurnIntegrationOverride: turnOverrides.addTurnIntegrationOverride,
    removeTurnIntegrationOverride: turnOverrides.removeTurnIntegrationOverride,
    clearTurnOverrides: turnOverrides.clearTurnOverrides,
    // KB files
    selectedKBFileIds: knowledgeBaseSelection.selectedKBFileIds,
    toggleKBFile: knowledgeBaseSelection.toggleKBFile,
    clearKBFiles: knowledgeBaseSelection.clearKBFiles,
    // Panel
    activePanel: panelState.activePanel,
    setActivePanel: panelState.setActivePanel,
    closePanel: panelState.closePanel,
    handlePlusMenuSelect: panelState.handlePlusMenuSelect,
    badges,
    flushPendingState,
  };
}
