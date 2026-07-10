import { useCallback, useEffect, useMemo, useRef, type Dispatch } from "react";
import type { AdvisorComposerAction, AdvisorComposerState } from "@/advisors/composerReducer";
import type { AdvisorSelection, ChatAdvisorView, ChatAdvisorsResult } from "@/advisors/types";

interface HydrationArgs {
  chatKey: string | null;
  queryResult: ChatAdvisorsResult | undefined;
  state: AdvisorComposerState;
  dispatch: Dispatch<AdvisorComposerAction>;
}

interface PendingSavedVersion {
  chatKey: string;
  version: string;
}

/** Owns first hydration and cross-device reconciliation for kept assignments. */
export function useAdvisorAssignmentsHydration({
  chatKey,
  queryResult,
  state,
  dispatch,
}: HydrationArgs) {
  const persistedAdvisors = useMemo(() => queryResult?.advisors ?? [], [queryResult?.advisors]);
  const persistedBaselineRef = useRef<{
    chatKey: string | null;
    advisors: ChatAdvisorView[];
  }>({ chatKey: null, advisors: [] });
  const pendingSavedVersionRef = useRef<PendingSavedVersion | null>(null);

  useEffect(() => {
    if (!chatKey || !queryResult) return;
    const baseline = persistedBaselineRef.current.chatKey === chatKey
      ? persistedBaselineRef.current.advisors
      : [];
    if (!state.isHydrated) {
      persistedBaselineRef.current = { chatKey, advisors: queryResult.advisors };
      dispatch({ type: "hydrate", advisors: queryResult.advisors });
      return;
    }
    if (state.surface !== "closed" || state.isSaving) return;
    const nextVersion = persistedAssignmentsVersion(queryResult.advisors);
    const pendingSave = pendingSavedVersionRef.current?.chatKey === chatKey
      ? pendingSavedVersionRef.current
      : null;
    if (pendingSave !== null) {
      if (pendingSave.version !== nextVersion) return;
      pendingSavedVersionRef.current = null;
    }
    if (persistedAssignmentsVersion(baseline) === nextVersion) return;
    persistedBaselineRef.current = { chatKey, advisors: queryResult.advisors };
    dispatch({
      type: "syncPersisted",
      previousAdvisors: baseline,
      advisors: queryResult.advisors,
    });
  }, [chatKey, dispatch, queryResult, state.isHydrated, state.isSaving, state.surface]);

  const markPendingSave = useCallback((savedChatKey: string, selections: AdvisorSelection[]) => {
    pendingSavedVersionRef.current = {
      chatKey: savedChatKey,
      version: selectionAssignmentsVersion(selections),
    };
  }, []);

  return { persistedAdvisors, markPendingSave };
}

function persistedAssignmentsVersion(advisors: ChatAdvisorView[]): string {
  return JSON.stringify([...advisors]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((advisor) => [String(advisor.personaId), advisor.allowWebSearch]));
}

function selectionAssignmentsVersion(selections: AdvisorSelection[]): string {
  return JSON.stringify(selections.map((selection) => [
    String(selection.personaId),
    selection.allowWebSearch,
  ]));
}
