import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  createPresentationEditorState,
  presentationEditorReducer,
} from "@/lib/presentations/presentationReducer";
import type {
  PresentationPanelTab,
  PresentationSlideRecord,
} from "@/lib/presentations/types";

export interface SavePresentationSlideInput {
  slideId: string;
  expectedRevision: number;
  title: string;
  html: string;
  notes?: string;
}

interface UsePresentationEditorOptions {
  slides: PresentationSlideRecord[];
  saveSlide: (input: SavePresentationSlideInput) => Promise<PresentationSlideRecord>;
  onError: (error: unknown) => void;
}

export function usePresentationEditor({
  slides,
  saveSlide,
  onError,
}: UsePresentationEditorOptions) {
  const [state, dispatch] = useReducer(
    presentationEditorReducer,
    slides,
    createPresentationEditorState,
  );
  const [notesOpen, setNotesOpen] = useState(false);
  const [hasPendingSaves, setHasPendingSaves] = useState(false);
  const revisionRef = useRef(new Map<string, number>());
  const saveQueuesRef = useRef(new Map<string, Promise<void>>());
  const saveTokensRef = useRef(new Map<string, symbol>());
  const failedSaveSlideIdsRef = useRef(new Set<string>());
  const slideDraftsRef = useRef(new Map<string, {
    title: string;
    html: string;
    notes?: string;
  }>());
  const serverSlidesRef = useRef(slides);
  const serverSignature = useMemo(
    () => JSON.stringify(slides.map((slide) => [
      slide.slideId,
      slide.revision,
      slide.position,
      slide.updatedAt,
    ])),
    [slides],
  );

  useEffect(() => {
    serverSlidesRef.current = slides;
  }, [serverSignature, slides]);

  useEffect(() => {
    const hydratedSlides = serverSlidesRef.current.map((slide) => {
      const knownRevision = revisionRef.current.get(slide.slideId) ?? slide.revision;
      const draft = slideDraftsRef.current.get(slide.slideId);
      const hasPendingSave = saveQueuesRef.current.has(slide.slideId);
      const hasFailedSave = failedSaveSlideIdsRef.current.has(slide.slideId);
      const shouldPreserveDraft = draft && (
        hasPendingSave
        || hasFailedSave
        || knownRevision > slide.revision
      );
      if (shouldPreserveDraft) return { ...slide, ...draft, revision: knownRevision };
      if (draft) slideDraftsRef.current.delete(slide.slideId);
      revisionRef.current.set(slide.slideId, Math.max(knownRevision, slide.revision));
      return slide;
    });
    dispatch({ type: "hydrate", slides: hydratedSlides });
  }, [serverSignature]);

  const activeSlide = state.slides.find((slide) => slide.slideId === state.activeSlideId) ?? null;
  const activeSlideIndex = activeSlide
    ? state.slides.findIndex((slide) => slide.slideId === activeSlide.slideId)
    : -1;

  const refreshSaveStatus = useCallback(() => {
    const pending = saveQueuesRef.current.size > 0;
    setHasPendingSaves(pending);
    dispatch({
      type: "set_save_status",
      status: pending ? "saving" : failedSaveSlideIdsRef.current.size > 0 ? "error" : "saved",
    });
  }, []);

  const enqueueSave = useCallback((input: Omit<SavePresentationSlideInput, "expectedRevision">) => {
    failedSaveSlideIdsRef.current.delete(input.slideId);
    const previous = saveQueuesRef.current.get(input.slideId) ?? Promise.resolve();
    const saveToken = Symbol(input.slideId);
    const next = previous.catch(() => undefined).then(async () => {
      const expectedRevision = revisionRef.current.get(input.slideId) ?? 0;
      try {
        const saved = await saveSlide({ ...input, expectedRevision });
        failedSaveSlideIdsRef.current.delete(input.slideId);
        revisionRef.current.set(saved.slideId, saved.revision);
        if (saveTokensRef.current.get(input.slideId) === saveToken) {
          dispatch({ type: "sync_slide", slide: saved });
        }
      } catch (error) {
        failedSaveSlideIdsRef.current.add(input.slideId);
        onError(error);
      }
    });
    saveQueuesRef.current.set(input.slideId, next);
    saveTokensRef.current.set(input.slideId, saveToken);
    refreshSaveStatus();
    void next.finally(() => {
      if (saveTokensRef.current.get(input.slideId) === saveToken) {
        saveQueuesRef.current.delete(input.slideId);
        saveTokensRef.current.delete(input.slideId);
        refreshSaveStatus();
      }
    });
  }, [onError, refreshSaveStatus, saveSlide]);

  const replaceActiveHtml = useCallback((html: string) => {
    if (!activeSlide || html === activeSlide.html) return;
    const currentDraft = slideDraftsRef.current.get(activeSlide.slideId) ?? {
      title: activeSlide.title,
      html: activeSlide.html,
      notes: activeSlide.notes,
    };
    const nextDraft = { ...currentDraft, html };
    slideDraftsRef.current.set(activeSlide.slideId, nextDraft);
    dispatch({ type: "replace_html", slideId: activeSlide.slideId, html });
    enqueueSave({ slideId: activeSlide.slideId, ...nextDraft });
  }, [activeSlide, enqueueSave]);

  const saveActiveNotes = useCallback((notes: string) => {
    if (!activeSlide || notes === (activeSlide.notes ?? "")) return;
    const currentDraft = slideDraftsRef.current.get(activeSlide.slideId) ?? {
      title: activeSlide.title,
      html: activeSlide.html,
      notes: activeSlide.notes,
    };
    const nextDraft = { ...currentDraft, notes: notes || undefined };
    slideDraftsRef.current.set(activeSlide.slideId, nextDraft);
    dispatch({ type: "replace_notes", slideId: activeSlide.slideId, notes: nextDraft.notes });
    enqueueSave({ slideId: activeSlide.slideId, ...nextDraft });
  }, [activeSlide, enqueueSave]);

  const undo = useCallback(() => {
    const entry = state.history.at(-1);
    if (!entry) return;
    const slide = state.slides.find((candidate) => candidate.slideId === entry.slideId);
    dispatch({ type: "undo" });
    if (!slide) return;
    const draft = {
      slideId: entry.slideId,
      title: slide.title,
      html: entry.html,
      notes: slide.notes,
    };
    slideDraftsRef.current.set(entry.slideId, draft);
    enqueueSave(draft);
  }, [enqueueSave, state.history, state.slides]);

  const redo = useCallback(() => {
    const entry = state.future.at(-1);
    if (!entry) return;
    const slide = state.slides.find((candidate) => candidate.slideId === entry.slideId);
    dispatch({ type: "redo" });
    if (!slide) return;
    const draft = {
      slideId: entry.slideId,
      title: slide.title,
      html: entry.html,
      notes: slide.notes,
    };
    slideDraftsRef.current.set(entry.slideId, draft);
    enqueueSave(draft);
  }, [enqueueSave, state.future, state.slides]);

  return {
    state,
    activeSlide,
    activeSlideIndex,
    hasPendingSaves,
    notesOpen,
    selectSlide: (slideId: string) => dispatch({ type: "select_slide", slideId }),
    selectElement: (elementId: string | null) => dispatch({ type: "select_element", elementId }),
    setPanelTab: (tab: PresentationPanelTab) => dispatch({ type: "set_tab", tab }),
    setZoom: (zoom: number) => dispatch({ type: "set_zoom", zoom }),
    toggleNotes: () => setNotesOpen((current) => !current),
    replaceActiveHtml,
    saveActiveNotes,
    undo,
    redo,
  };
}
