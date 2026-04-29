// hooks/useChatOverrides.ts
// Manages per-chat override state: parameter overrides, skill overrides (M30 tri-state),
// integration overrides (M30 persisted), KB file selections, and turn overrides.

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ChatParameterOverrides } from "@/components/chat/ChatParametersDrawer";
import type { IntegrationKey } from "@/routes/PersonaEditorForm";
import type { PlusMenuItem } from "@/components/chat/ChatPlusMenu";
import type { Chat, UseChatReturn } from "@/hooks/useChat";

// ─── M30 types ──────────────────────────────────────────────────────────────

export type SkillOverrideState = "always" | "available" | "never";

export interface SkillOverrideEntry {
  skillId: Id<"skills">;
  state: SkillOverrideState;
}

export interface IntegrationOverrideEntry {
  integrationId: string;
  enabled: boolean;
}

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
  /** M30: layered skill overrides on persona */
  skillOverrides?: Array<{ skillId: string; state: SkillOverrideState }> | null;
  /** M30: layered integration overrides on persona */
  integrationOverrides?: Array<{ integrationId: string; enabled: boolean }> | null;
}

interface UseChatOverridesArgs {
  chat: Chat | null | undefined;
  chatId: Id<"chats"> | undefined;
  activePersona: SkillPersonaSource | null;
  updateChat: UseChatReturn["updateChat"];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function mapEquals<V>(a: Map<string, V>, b: Map<string, V>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, val] of a) {
    if (b.get(key) !== val) return false;
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

/** Build skill overrides map from chat M30 fields layered on top of persona defaults. */
function skillOverridesFromChat(
  chat: Chat | null | undefined,
  personaDefaults: Map<string, SkillOverrideState>,
): Map<string, SkillOverrideState> {
  const result = new Map(personaDefaults);
  for (const entry of chat?.skillOverrides ?? []) {
    result.set(entry.skillId, entry.state);
  }
  return result;
}

/** Build integration overrides map from chat M30 fields, falling back to persona defaults. */
function integrationOverridesFromChat(
  chat: Chat | null | undefined,
  personaDefaults: Map<string, boolean>,
): Map<string, boolean> {
  if (chat?.integrationOverrides && chat.integrationOverrides.length > 0) {
    const result = new Map(personaDefaults);
    for (const entry of chat.integrationOverrides) {
      result.set(entry.integrationId, entry.enabled);
    }
    return result;
  }
  // No chat-level overrides — inherit persona defaults
  return new Map(personaDefaults);
}

/** Derive persona skill defaults from M30 skillOverrides, falling back to legacy discoverableSkillIds. */
function personaSkillDefaults(persona: SkillPersonaSource | null): Map<string, SkillOverrideState> {
  if (!persona) return new Map();
  return new Map((persona.skillOverrides ?? []).map((e) => [e.skillId, e.state]));
}

/** Derive persona integration defaults from M30 integrationOverrides. */
function personaIntegrationDefaults(persona: SkillPersonaSource | null): Map<string, boolean> {
  if (!persona) return new Map();
  return new Map((persona.integrationOverrides ?? []).map((e) => [e.integrationId, e.enabled]));
}

/** Derive enabled skill IDs from skill overrides (for backward-compat send path). */
export function enabledSkillIdsFromOverrides(overrides: Map<string, SkillOverrideState>): Set<string> {
  const result = new Set<string>();
  for (const [id, state] of overrides) {
    if (state === "always" || state === "available") result.add(id);
  }
  return result;
}

/** Derive enabled integration keys from integration overrides. */
export function enabledIntegrationKeysFromOverrides(overrides: Map<string, boolean>): Set<IntegrationKey> {
  const result = new Set<IntegrationKey>();
  for (const [key, enabled] of overrides) {
    if (enabled) result.add(key as IntegrationKey);
  }
  return result;
}

/** Cycle skill override state: null → available → always → never → null */
export function cycleSkillState(current: SkillOverrideState | undefined): SkillOverrideState | undefined {
  switch (current) {
    case undefined: return "available";
    case "available": return "always";
    case "always": return "never";
    case "never": return undefined;
  }
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
  const [selectedKBFileIds, setSelectedKBFileIds] = useState<Set<string>>(new Set());
  const [activePanel, setActivePanel] = useState<ChatPanel>(null);
  // Turn overrides (slash chips) — ephemeral per-send
  const [turnSkillOverrides, setTurnSkillOverrides] = useState<Map<string, SkillOverrideState>>(new Map());
  const [turnIntegrationOverrides, setTurnIntegrationOverrides] = useState<Map<string, boolean>>(new Map());
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
    if (pendingParamOverrides && JSON.stringify(pendingParamOverrides) === JSON.stringify(resolvedParamOverrides)) {
      // Drop optimistic state once Convex reflects the same parameter overrides.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPendingParamOverrides(null);
    }
  }, [pendingParamOverrides, resolvedParamOverrides]);

  useEffect(() => {
    if (pendingSkillOverrides && mapEquals(pendingSkillOverrides, resolvedSkillOverrides)) {
      // Drop optimistic state once Convex reflects the same skill overrides.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPendingSkillOverrides(null);
    }
  }, [pendingSkillOverrides, resolvedSkillOverrides]);

  useEffect(() => {
    if (pendingIntegrationOverrides && mapEquals(pendingIntegrationOverrides, resolvedIntegrationOverrides)) {
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
      const entries: SkillOverrideEntry[] = Array.from(next, ([skillId, state]) => ({ skillId: skillId as Id<"skills">, state }));
      // M30 path
      await setChatSkillOverrides({
        chatId: targetChatId,
        skillOverrides: entries,
      });
    },
    [setChatSkillOverrides],
  );

  const persistIntegrationOverrides = useCallback(
    async (targetChatId: Id<"chats">, next: Map<string, boolean>) => {
      const entries: IntegrationOverrideEntry[] = Array.from(next, ([integrationId, enabled]) => ({ integrationId, enabled }));
      await setChatIntegrationOverrides({
        chatId: targetChatId,
        integrationOverrides: entries,
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

  /** Cycle a skill's override state: undefined → available → always → never → undefined */
  const cycleSkill = useCallback((skillId: Id<"skills">) => {
    const id = skillId as string;
    const applyUpdate = (current: Map<string, SkillOverrideState>) => {
      const next = new Map(current);
      const newState = cycleSkillState(next.get(id));
      if (newState === undefined) next.delete(id);
      else next.set(id, newState);
      return next;
    };

    if (!chatId) {
      draftSkillDirtyRef.current = true;
      setDraftSkillOverrides((prev) => applyUpdate(prev));
      return;
    }

    const next = applyUpdate(skillOverrides);
    setPendingSkillOverrides(next);
    void persistSkillOverrides(chatId, next).catch((err) => {
      console.error("[useChatOverrides] persistSkillOverrides failed:", err);
      setPendingSkillOverrides(null);
    });
  }, [chatId, skillOverrides, persistSkillOverrides]);

  /** Binary toggle for legacy consumers. Toggles between available and never. */
  const toggleSkill = useCallback((skillId: Id<"skills">) => {
    const id = skillId as string;
    const applyToggle = (current: Map<string, SkillOverrideState>) => {
      const next = new Map(current);
      const currentState = next.get(id);
      if (currentState === "always" || currentState === "available") {
        next.delete(id);
      } else {
        next.set(id, "available");
      }
      return next;
    };

    if (!chatId) {
      draftSkillDirtyRef.current = true;
      setDraftSkillOverrides((prev) => applyToggle(prev));
      return;
    }

    const next = applyToggle(skillOverrides);
    setPendingSkillOverrides(next);
    void persistSkillOverrides(chatId, next).catch((err) => {
      console.error("[useChatOverrides] persistSkillOverrides failed:", err);
      setPendingSkillOverrides(null);
    });
  }, [chatId, skillOverrides, persistSkillOverrides]);

  const toggleIntegration = useCallback((key: IntegrationKey) => {
    const applyToggle = (current: Map<string, boolean>) => {
      const next = new Map(current);
      const isEnabled = next.get(key);
      if (isEnabled === true) next.set(key, false);
      else next.set(key, true);
      return next;
    };

    if (!chatId) {
      draftIntegrationDirtyRef.current = true;
      setDraftIntegrationOverrides((prev) => applyToggle(prev));
      return;
    }

    const next = applyToggle(integrationOverrides);
    setPendingIntegrationOverrides(next);
    void persistIntegrationOverrides(chatId, next).catch((err) => {
      console.error("[useChatOverrides] persistIntegrationOverrides failed:", err);
      setPendingIntegrationOverrides(null);
    });
  }, [chatId, integrationOverrides, persistIntegrationOverrides]);

  // ── Turn overrides (slash chips) ──────────────────────────────────────────

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

  // Serialized turn overrides for the send path
  const turnSkillOverrideEntries = useMemo(
    () => Array.from(turnSkillOverrides, ([skillId, state]) => ({ skillId: skillId as Id<"skills">, state })),
    [turnSkillOverrides],
  );

  const turnIntegrationOverrideEntries = useMemo(
    () => Array.from(turnIntegrationOverrides, ([integrationId, enabled]) => ({ integrationId, enabled })),
    [turnIntegrationOverrides],
  );

  // ── KB files ──────────────────────────────────────────────────────────────

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

  // ── Plus menu ─────────────────────────────────────────────────────────────

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
      // "file", "image" handled by MessageInput / ChatPage
    }
  }, []);

  const closePanel = useCallback(() => setActivePanel(null), []);

  // ── Badge counts ──────────────────────────────────────────────────────────

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

  // ── Flush pending state (on first send for new chats) ─────────────────────

  const flushPendingState = useCallback(
    async (targetChatId: Id<"chats">) => {
      if (!chatId) {
        if (draftParamDirtyRef.current) {
          await persistParamOverrides(targetChatId, draftParamOverrides);
        }
        if (draftSkillDirtyRef.current) {
          await persistSkillOverrides(targetChatId, draftSkillOverrides);
        }
        if (draftIntegrationDirtyRef.current) {
          await persistIntegrationOverrides(targetChatId, draftIntegrationOverrides);
        }
        return;
      }

      if (pendingParamOverrides) {
        await persistParamOverrides(targetChatId, pendingParamOverrides);
      }
      if (pendingSkillOverrides) {
        await persistSkillOverrides(targetChatId, pendingSkillOverrides);
      }
      if (pendingIntegrationOverrides) {
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
    turnSkillOverrides,
    turnIntegrationOverrides,
    turnSkillOverrideEntries,
    turnIntegrationOverrideEntries,
    addTurnSkillOverride,
    removeTurnSkillOverride,
    addTurnIntegrationOverride,
    removeTurnIntegrationOverride,
    clearTurnOverrides,
    // KB files
    selectedKBFileIds,
    toggleKBFile,
    clearKBFiles,
    // Panel
    activePanel,
    setActivePanel,
    closePanel,
    handlePlusMenuSelect,
    badges,
    flushPendingState,
  };
}
