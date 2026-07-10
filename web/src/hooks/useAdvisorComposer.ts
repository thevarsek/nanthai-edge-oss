import { useCallback, useLayoutEffect, useMemo, useReducer } from "react";
import { useMutation, useQuery } from "convex/react";
import { useTranslation } from "react-i18next";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  advisorComposerReducer,
  advisorQueueSnapshot,
  advisorSendProjection,
  INITIAL_ADVISOR_COMPOSER_STATE,
  type AdvisorComposerState,
} from "@/advisors/composerReducer";
import type {
  AdvisorEligibility,
  AdvisorSelection,
  ChatAdvisorsResult,
  QueuedAdvisorSnapshot,
} from "@/advisors/types";
import type { PersonaItem } from "@/components/chat/ChatParticipantPicker.helpers";
import type { Participant } from "@/hooks/useChat";
import { captureAnalytics } from "@/lib/analytics";
import { convexErrorMessage } from "@/lib/convexErrors";
import type { ModelSummary } from "@/components/shared/ModelPickerHelpers";
import { useAdvisorAssignmentsHydration } from "@/hooks/useAdvisorAssignmentsHydration";
import { useAdvisorComposerProjection } from "@/hooks/useAdvisorComposerProjection";

interface UseAdvisorComposerArgs {
  chatId: Id<"chats"> | undefined;
  participants: Participant[];
  turnIntegrationOverrides?: Array<{ integrationId: string; enabled: boolean }>;
  personas: readonly PersonaItem[] | undefined;
  isPro: boolean;
  effectiveWebSearch: boolean;
  modelSummaries?: readonly ModelSummary[];
  defaultModelId?: string;
}

export interface AdvisorComposerOwner {
  state: AdvisorComposerState;
  participantCount: number;
  eligibility: AdvisorEligibility | undefined;
  isHydrated: boolean;
  unavailablePersonaIds: ReadonlySet<string>;
  persistedPersonaIds: ReadonlySet<string>;
  participantPersonaIds: ReadonlySet<string>;
  selectedPersonas: PersonaItem[];
  canSendCurrentSelection: boolean;
  canCaptureQueuedSnapshot: boolean;
  advisorSelections: AdvisorSelection[] | undefined;
  advisorBrief: string | undefined;
  open: () => void;
  close: () => void;
  togglePersona: (personaId: Id<"personas">) => void;
  updateSelection: (
    personaId: Id<"personas">,
    patch: Partial<Pick<AdvisorSelection, "allowWebSearch" | "keepAvailable">>,
  ) => void;
  remove: (personaId: Id<"personas">) => Promise<void>;
  setBrief: (brief: string) => void;
  setDefaultAllowWebSearch: (value: boolean) => void;
  setDefaultKeepAvailable: (value: boolean) => void;
  save: () => Promise<void>;
  captureQueuedSnapshot: () => QueuedAdvisorSnapshot | null;
  restoreQueuedSnapshot: (snapshot: QueuedAdvisorSnapshot) => void;
  completeSuccessfulSend: () => void;
}

export function useAdvisorComposer({
  chatId,
  participants,
  turnIntegrationOverrides,
  personas,
  isPro,
  effectiveWebSearch,
  modelSummaries,
  defaultModelId,
}: UseAdvisorComposerArgs): AdvisorComposerOwner {
  const { t } = useTranslation();
  const chatKey = chatId ? String(chatId) : null;
  const [state, dispatch] = useReducer(advisorComposerReducer, {
    ...INITIAL_ADVISOR_COMPOSER_STATE,
    chatKey,
  });
  const currentState = useMemo(() => (
    state.chatKey === chatKey
      ? state
      : { ...INITIAL_ADVISOR_COMPOSER_STATE, chatKey }
  ), [chatKey, state]);
  useLayoutEffect(() => {
    if (state.chatKey === chatKey) return;
    dispatch({ type: "resetChat", chatKey });
  }, [chatKey, state.chatKey]);
  const participantArgs = useMemo(
    () => participants.map((participant) => ({
      modelId: participant.modelId,
      ...(participant.personaId ? { personaId: participant.personaId } : {}),
    })),
    [participants],
  );
  const queryResult = useQuery(
    api.advisors.queries.listChatAdvisors,
    chatId ? {
      chatId,
      participants: participantArgs,
      ...(currentState.selections.length ? { selectedPersonaIds: currentState.selections.map((selection) => selection.personaId) } : {}),
      ...(turnIntegrationOverrides?.length ? { turnIntegrationOverrides } : {}),
    } : "skip",
  ) as ChatAdvisorsResult | undefined;
  const setChatAdvisors = useMutation(api.advisors.mutations.setChatAdvisors);
  const removeChatAdvisor = useMutation(api.advisors.mutations.removeChatAdvisor);
  const { persistedAdvisors, markPendingSave } = useAdvisorAssignmentsHydration({
    chatKey,
    queryResult,
    state: currentState,
    dispatch,
  });

  const eligibility = queryResult?.eligibility;
  const isHydrated = chatId === undefined || currentState.isHydrated;
  const {
    eligibleState,
    participantPersonaIds,
    persistedPersonaIds,
    personaMap,
    savableKeptSelections,
    selectedPersonas,
    unavailablePersonaIds,
  } = useAdvisorComposerProjection({
    state: currentState,
    persistedAdvisors,
    participants,
    personas,
    modelSummaries,
    defaultModelId,
  });

  const open = useCallback(() => {
    if (!isPro || eligibility?.reasonCode === "not_pro") {
      dispatch({ type: "showPaywall" });
      return;
    }
    captureAnalytics("advisor_picker_opened", {
      feature_area: "advisors",
      chat_id: chatId ? String(chatId) : null,
      advisor_count: currentState.selections.length,
    });
    dispatch({ type: "open", allowWebSearch: effectiveWebSearch });
  }, [chatId, currentState.selections.length, effectiveWebSearch, eligibility?.reasonCode, isPro]);

  const close = useCallback(() => dispatch({ type: "close" }), []);
  const togglePersona = useCallback((personaId: Id<"personas">) => {
    const wasSelected = currentState.selections.some((selection) => selection.personaId === personaId);
    dispatch({ type: "toggle", personaId, maxAdvisors: eligibility?.maxAdvisors ?? 3 });
    if (!wasSelected && currentState.selections.length < (eligibility?.maxAdvisors ?? 3)) {
      const persona = personaMap.get(String(personaId));
      captureAnalytics("advisor_selected", {
        feature_area: "advisors",
        chat_id: chatId ? String(chatId) : null,
        advisor_count: currentState.selections.length + 1,
        model_id: persona?.modelId ?? null,
        web_search_enabled: currentState.defaultAllowWebSearch,
      });
    }
  }, [chatId, currentState.defaultAllowWebSearch, currentState.selections, eligibility?.maxAdvisors, personaMap]);
  const updateSelection = useCallback((
    personaId: Id<"personas">,
    patch: Partial<Pick<AdvisorSelection, "allowWebSearch" | "keepAvailable">>,
  ) => dispatch({ type: "update", personaId, patch }), []);
  const setBrief = useCallback((brief: string) => dispatch({ type: "setBrief", brief }), []);
  const setDefaultAllowWebSearch = useCallback((allowWebSearch: boolean) => {
    dispatch({ type: "setDefaults", allowWebSearch });
  }, []);
  const setDefaultKeepAvailable = useCallback((keepAvailable: boolean) => {
    dispatch({ type: "setDefaults", keepAvailable });
  }, []);

  const remove = useCallback(async (personaId: Id<"personas">) => {
    if (!chatId || !persistedPersonaIds.has(String(personaId))) {
      dispatch({ type: "remove", personaId });
      return;
    }
    try {
      await removeChatAdvisor({ chatId, personaId });
      dispatch({ type: "remove", personaId });
    } catch (error) {
      dispatch({ type: "saveFailed", message: convexErrorMessage(error, t("advisor_remove_failed")) });
    }
  }, [chatId, persistedPersonaIds, removeChatAdvisor, t]);

  const save = useCallback(async () => {
    if (!chatId) {
      dispatch({ type: "saveCompleted" });
      return;
    }
    if (!isHydrated || currentState.isSaving) {
      dispatch({ type: "saveFailed", message: t("advisor_loading") });
      return;
    }
    dispatch({ type: "saveStarted" });
    try {
      await setChatAdvisors({
        chatId,
        advisors: savableKeptSelections.map(({ personaId, allowWebSearch }) => ({ personaId, allowWebSearch })),
      });
      markPendingSave(String(chatId), savableKeptSelections);
      dispatch({ type: "saveCompleted" });
    } catch (error) {
      dispatch({
        type: "saveFailed",
        message: convexErrorMessage(error, t("advisor_save_failed")),
      });
    }
  }, [chatId, currentState.isSaving, isHydrated, markPendingSave, savableKeptSelections, setChatAdvisors, t]);

  const completeSuccessfulSend = useCallback(() => {
    dispatch({ type: "sendCompleted" });
  }, []);
  const canSendCurrentSelection = isHydrated || currentState.selections.length === 0;
  const canCaptureQueuedSnapshot = isHydrated;
  const captureQueuedSnapshot = useCallback(() => {
    if (!isHydrated) return null;
    const snapshot = advisorQueueSnapshot(eligibleState, eligibility);
    if (eligibility?.isAvailable !== false && snapshot.advisorSelections.length > 0) {
      dispatch({ type: "sendCompleted" });
    }
    return snapshot;
  }, [eligibility, eligibleState, isHydrated]);
  const restoreQueuedSnapshot = useCallback((snapshot: QueuedAdvisorSnapshot) => {
    dispatch({
      type: "restoreQueuedSnapshot",
      snapshot,
      maxAdvisors: eligibility?.maxAdvisors ?? 3,
    });
  }, [eligibility?.maxAdvisors]);
  const sendProjection = useMemo(() => {
    if (!canSendCurrentSelection) return {};
    const projection = advisorSendProjection(eligibleState, eligibility);
    if (
      eligibility?.isAvailable !== false &&
      currentState.selections.length > 0 &&
      eligibleState.selections.length === 0
    ) {
      return { advisorSelections: [] as AdvisorSelection[] };
    }
    return projection;
  }, [canSendCurrentSelection, currentState.selections.length, eligibility, eligibleState]);

  return {
    state: currentState,
    participantCount: participants.length,
    eligibility,
    isHydrated,
    unavailablePersonaIds,
    persistedPersonaIds,
    participantPersonaIds,
    selectedPersonas,
    canSendCurrentSelection,
    canCaptureQueuedSnapshot,
    advisorSelections: sendProjection.advisorSelections,
    advisorBrief: sendProjection.advisorBrief,
    open,
    close,
    togglePersona,
    updateSelection,
    remove,
    setBrief,
    setDefaultAllowWebSearch,
    setDefaultKeepAvailable,
    save,
    captureQueuedSnapshot,
    restoreQueuedSnapshot,
    completeSuccessfulSend,
  };
}
