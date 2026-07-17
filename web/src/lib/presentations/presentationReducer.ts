import type {
  PresentationPanelTab,
  PresentationSaveStatus,
  PresentationSlideRecord,
} from "./types";

interface HistoryEntry {
  slideId: string;
  html: string;
}

export interface PresentationEditorState {
  slides: PresentationSlideRecord[];
  activeSlideId: string | null;
  selectedElementId: string | null;
  panelTab: PresentationPanelTab;
  zoom: number;
  saveStatus: PresentationSaveStatus;
  history: HistoryEntry[];
  future: HistoryEntry[];
}

export type PresentationEditorAction =
  | { type: "hydrate"; slides: PresentationSlideRecord[] }
  | { type: "select_slide"; slideId: string }
  | { type: "select_element"; elementId: string | null }
  | { type: "replace_html"; slideId: string; html: string }
  | { type: "replace_notes"; slideId: string; notes?: string }
  | { type: "sync_slide"; slide: PresentationSlideRecord }
  | { type: "set_tab"; tab: PresentationPanelTab }
  | { type: "set_zoom"; zoom: number }
  | { type: "set_save_status"; status: PresentationSaveStatus }
  | { type: "undo" }
  | { type: "redo" };

export function createPresentationEditorState(
  slides: PresentationSlideRecord[] = [],
): PresentationEditorState {
  return {
    slides,
    activeSlideId: slides[0]?.slideId ?? null,
    selectedElementId: null,
    panelTab: "ai",
    zoom: 0.76,
    saveStatus: slides.length > 0 ? "saved" : "idle",
    history: [],
    future: [],
  };
}

function replaceSlideHtml(
  slides: PresentationSlideRecord[],
  slideId: string,
  html: string,
): PresentationSlideRecord[] {
  return slides.map((slide) => slide.slideId === slideId ? { ...slide, html } : slide);
}

function slidesMatch(
  current: PresentationSlideRecord[],
  incoming: PresentationSlideRecord[],
): boolean {
  return current.length === incoming.length && current.every((slide, index) => {
    const next = incoming[index];
    return next != null
      && slide._id === next._id
      && slide.slideId === next.slideId
      && slide.position === next.position
      && slide.title === next.title
      && slide.notes === next.notes
      && slide.html === next.html
      && slide.revision === next.revision
      && slide.updatedAt === next.updatedAt;
  });
}

function restoreHistory(
  state: PresentationEditorState,
  source: "history" | "future",
): PresentationEditorState {
  const entries = state[source];
  const entry = entries.at(-1);
  if (!entry) return state;
  const current = state.slides.find((slide) => slide.slideId === entry.slideId);
  if (!current) return state;
  const destination = source === "history" ? "future" : "history";
  return {
    ...state,
    slides: replaceSlideHtml(state.slides, entry.slideId, entry.html),
    [source]: entries.slice(0, -1),
    [destination]: [...state[destination], { slideId: entry.slideId, html: current.html }],
    activeSlideId: entry.slideId,
    selectedElementId: null,
    saveStatus: "saving",
  };
}

export function presentationEditorReducer(
  state: PresentationEditorState,
  action: PresentationEditorAction,
): PresentationEditorState {
  switch (action.type) {
    case "hydrate": {
      if (slidesMatch(state.slides, action.slides)) return state;
      const activeExists = action.slides.some((slide) => slide.slideId === state.activeSlideId);
      return {
        ...state,
        slides: action.slides,
        activeSlideId: activeExists ? state.activeSlideId : (action.slides[0]?.slideId ?? null),
        selectedElementId: activeExists ? state.selectedElementId : null,
      };
    }
    case "select_slide":
      return { ...state, activeSlideId: action.slideId, selectedElementId: null };
    case "select_element":
      return { ...state, selectedElementId: action.elementId };
    case "replace_html": {
      const current = state.slides.find((slide) => slide.slideId === action.slideId);
      if (!current || current.html === action.html) return state;
      return {
        ...state,
        slides: replaceSlideHtml(state.slides, action.slideId, action.html),
        history: [...state.history, { slideId: action.slideId, html: current.html }].slice(-50),
        future: [],
        saveStatus: "saving",
      };
    }
    case "replace_notes":
      return {
        ...state,
        slides: state.slides.map((slide) => (
          slide.slideId === action.slideId ? { ...slide, notes: action.notes } : slide
        )),
        saveStatus: "saving",
      };
    case "sync_slide":
      return {
        ...state,
        slides: state.slides.map((slide) => slide.slideId === action.slide.slideId ? action.slide : slide),
      };
    case "set_tab":
      return { ...state, panelTab: action.tab };
    case "set_zoom":
      return { ...state, zoom: Math.min(1.25, Math.max(0.4, action.zoom)) };
    case "set_save_status":
      return { ...state, saveStatus: action.status };
    case "undo":
      return restoreHistory(state, "history");
    case "redo":
      return restoreHistory(state, "future");
  }
}
