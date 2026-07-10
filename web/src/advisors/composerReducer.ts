import type {
  AdvisorEligibility,
  AdvisorSelection,
  ChatAdvisorView,
  QueuedAdvisorSnapshot,
} from "@/advisors/types";

export type AdvisorComposerSurface = "closed" | "picker" | "paywall";

export interface AdvisorComposerState {
  chatKey: string | null;
  surface: AdvisorComposerSurface;
  selections: AdvisorSelection[];
  brief: string;
  defaultAllowWebSearch: boolean;
  defaultKeepAvailable: boolean;
  saveError: string | null;
  isSaving: boolean;
  isHydrated: boolean;
}

export type AdvisorComposerAction =
  | { type: "resetChat"; chatKey: string | null }
  | { type: "hydrate"; advisors: ChatAdvisorView[] }
  | { type: "syncPersisted"; previousAdvisors: ChatAdvisorView[]; advisors: ChatAdvisorView[] }
  | { type: "open"; allowWebSearch: boolean }
  | { type: "showPaywall" }
  | { type: "close" }
  | { type: "toggle"; personaId: AdvisorSelection["personaId"]; maxAdvisors: number }
  | { type: "update"; personaId: AdvisorSelection["personaId"]; patch: Partial<Pick<AdvisorSelection, "allowWebSearch" | "keepAvailable">> }
  | { type: "remove"; personaId: AdvisorSelection["personaId"] }
  | { type: "setBrief"; brief: string }
  | { type: "setDefaults"; allowWebSearch?: boolean; keepAvailable?: boolean }
  | { type: "saveStarted" }
  | { type: "saveFailed"; message: string }
  | { type: "saveCompleted" }
  | { type: "restoreQueuedSnapshot"; snapshot: QueuedAdvisorSnapshot; maxAdvisors: number }
  | { type: "sendCompleted" };

export const INITIAL_ADVISOR_COMPOSER_STATE: AdvisorComposerState = {
  chatKey: null,
  surface: "closed",
  selections: [],
  brief: "",
  defaultAllowWebSearch: false,
  defaultKeepAvailable: false,
  saveError: null,
  isSaving: false,
  isHydrated: false,
};

function selectionsFromAdvisors(advisors: ChatAdvisorView[]): AdvisorSelection[] {
  return [...advisors]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((advisor) => ({
      personaId: advisor.personaId,
      allowWebSearch: advisor.allowWebSearch,
      keepAvailable: true,
    }));
}

export function advisorComposerReducer(
  state: AdvisorComposerState,
  action: AdvisorComposerAction,
): AdvisorComposerState {
  switch (action.type) {
    case "resetChat":
      return { ...INITIAL_ADVISOR_COMPOSER_STATE, chatKey: action.chatKey };
    case "hydrate": {
      const persisted = selectionsFromAdvisors(action.advisors);
      const persistedIds = new Set(persisted.map((selection) => String(selection.personaId)));
      const merged = [...persisted, ...state.selections.filter(
        (selection) => !persistedIds.has(String(selection.personaId)),
      )];
      return {
        ...state,
        selections: merged,
        isHydrated: true,
      };
    }
    case "syncPersisted": {
      const previousIds = new Set(
        action.previousAdvisors.map((advisor) => String(advisor.personaId)),
      );
      const persisted = selectionsFromAdvisors(action.advisors);
      const persistedIds = new Set(persisted.map((selection) => String(selection.personaId)));
      const localOnly = state.selections.filter((selection) => (
        !persistedIds.has(String(selection.personaId)) && (
          !selection.keepAvailable || !previousIds.has(String(selection.personaId))
        )
      ));
      return {
        ...state,
        selections: [...persisted, ...localOnly],
      };
    }
    case "open":
      return {
        ...state,
        surface: "picker",
        defaultAllowWebSearch: action.allowWebSearch,
        saveError: null,
      };
    case "showPaywall":
      return { ...state, surface: "paywall" };
    case "close":
      return { ...state, surface: "closed", saveError: null };
    case "toggle": {
      const existing = state.selections.find((item) => item.personaId === action.personaId);
      if (existing) {
        const selections = state.selections.filter((item) => item.personaId !== action.personaId);
        return {
          ...state,
          selections,
          ...(selections.length === 0 ? { brief: "" } : {}),
        };
      }
      if (state.selections.length >= action.maxAdvisors) return state;
      return {
        ...state,
        selections: [...state.selections, {
          personaId: action.personaId,
          allowWebSearch: state.defaultAllowWebSearch,
          keepAvailable: state.defaultKeepAvailable,
        }],
      };
    }
    case "update":
      return {
        ...state,
        selections: state.selections.map((item) => (
          item.personaId === action.personaId ? { ...item, ...action.patch } : item
        )),
      };
    case "remove": {
      const selections = state.selections.filter((item) => item.personaId !== action.personaId);
      return {
        ...state,
        selections,
        ...(selections.length === 0 ? { brief: "" } : {}),
      };
    }
    case "setBrief":
      return state.selections.length > 0 ? { ...state, brief: action.brief } : state;
    case "setDefaults":
      return {
        ...state,
        defaultAllowWebSearch: action.allowWebSearch ?? state.defaultAllowWebSearch,
        defaultKeepAvailable: action.keepAvailable ?? state.defaultKeepAvailable,
      };
    case "saveStarted":
      return { ...state, saveError: null, isSaving: true };
    case "saveFailed":
      return { ...state, saveError: action.message, isSaving: false };
    case "saveCompleted":
      return { ...state, surface: "closed", saveError: null, isSaving: false };
    case "restoreQueuedSnapshot": {
      const restored = action.snapshot.advisorSelections.map((selection) => ({
        ...selection,
        keepAvailable: false,
      }));
      return {
        ...state,
        selections: [...state.selections, ...restored]
          .filter((selection, index, selections) => (
            selections.findIndex((candidate) => candidate.personaId === selection.personaId) === index
          ))
          .slice(0, action.maxAdvisors),
        brief: state.brief.trim() ? state.brief : (action.snapshot.advisorBrief ?? ""),
      };
    }
    case "sendCompleted":
      return {
        ...state,
        selections: state.selections.filter((selection) => selection.keepAvailable),
        brief: "",
        saveError: null,
      };
  }
}

export function advisorQueueSnapshot(
  state: AdvisorComposerState,
  eligibility: AdvisorEligibility | undefined,
): QueuedAdvisorSnapshot {
  if (eligibility?.isAvailable === false || state.selections.length === 0) {
    return { advisorSelections: [] };
  }
  return {
    advisorSelections: state.selections.map((selection) => ({
      ...selection,
      keepAvailable: false,
    })),
    ...(state.brief.trim() ? { advisorBrief: state.brief.trim() } : {}),
  };
}

export function advisorSendProjection(
  state: AdvisorComposerState,
  eligibility: AdvisorEligibility | undefined,
): { advisorSelections?: AdvisorSelection[]; advisorBrief?: string } {
  if (eligibility?.isAvailable === false) return {};
  if (state.selections.length === 0) return {};
  return {
    ...(state.selections.length > 0 ? { advisorSelections: state.selections } : {}),
    ...(state.brief.trim() ? { advisorBrief: state.brief.trim() } : {}),
  };
}
