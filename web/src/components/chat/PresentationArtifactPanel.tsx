import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Eye,
  FileDown,
  MessageSquare,
  MousePointer2,
  Pencil,
  Presentation,
  Printer,
  X,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PresentationContext } from "@/hooks/useChat";
import { usePresentationEditor } from "@/hooks/usePresentationEditor";
import { usePresentationSnapshotSync } from "@/hooks/usePresentationSnapshotSync";
import { useResizablePresentationPanel } from "@/hooks/useResizablePresentationPanel";
import { SlideFrame } from "@/components/presentations/SlideFrame";
import { PresentationSlideRail } from "@/components/presentations/PresentationSlideRail";
import {
  downloadPresentation,
  presentationExporter,
} from "@/lib/presentations";
import { printPresentation } from "@/lib/presentations/printPresentation";
import { renderSlidesForExport } from "@/lib/presentations/renderExportSlides";
import type {
  PresentationProjectPayload,
  PresentationSlideRecord,
} from "@/lib/presentations/types";
import { workspaceIconBlockClass } from "@/lib/uiTokens";

type InteractionMode = "view" | "select" | "edit";

interface PresentationArtifactPanelProps {
  projectId: string;
  filename: string;
  onClose: () => void;
  onStageContext?: (target: { context: PresentationContext; label: string }) => void;
  readOnly?: boolean;
}

function sortedSlides(slides: PresentationSlideRecord[]): PresentationSlideRecord[] {
  return [...slides].sort((left, right) => left.position - right.position);
}

function modeButtonClass(active: boolean): string {
  return `inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors ${
    active ? "bg-surface-3 text-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground"
  }`;
}

export function PresentationArtifactPanel({
  projectId,
  filename,
  onClose,
  onStageContext,
  readOnly = false,
}: PresentationArtifactPanelProps) {
  const typedProjectId = projectId as Id<"presentationProjects">;
  const payload = useQuery(
    api.presentations.queries.getProject,
    { projectId: typedProjectId },
  ) as PresentationProjectPayload | null | undefined;
  const saveSlideMutation = useMutation(api.presentations.mutations.saveSlide);
  const [mode, setMode] = useState<InteractionMode>("view");
  const [slideRailCollapsed, setSlideRailCollapsed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const slides = useMemo(() => sortedSlides(payload?.slides ?? []), [payload?.slides]);
  const assetUrls = useMemo(() => Object.fromEntries(
    (payload?.assets ?? []).map((asset) => [asset.storageId, asset.url]),
  ), [payload?.assets]);
  const { panelWidth, isResizing, resizeHandleProps } = useResizablePresentationPanel();
  const handleEditorError = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : "The slide could not be saved.");
  }, []);
  const handleSnapshotError = useCallback((cause: unknown) => {
    setError(cause instanceof Error
      ? `The PowerPoint snapshot is stale: ${cause.message}`
      : "The PowerPoint snapshot could not be refreshed.");
  }, []);

  const saveSlide = useCallback(async (input: {
    slideId: string;
    expectedRevision: number;
    title: string;
    html: string;
    notes?: string;
  }) => {
    const current = slides.find((slide) => slide.slideId === input.slideId);
    if (!current) throw new Error("Slide not found.");
    const result = await saveSlideMutation({
      projectId: typedProjectId,
      slideId: input.slideId,
      expectedRevision: input.expectedRevision,
      title: input.title,
      html: input.html,
      notes: input.notes ?? null,
    });
    setError(null);
    return {
      ...current,
      title: input.title,
      html: input.html,
      notes: input.notes,
      revision: result.slideRevision,
      updatedAt: Date.now(),
    };
  }, [saveSlideMutation, slides, typedProjectId]);

  const editor = usePresentationEditor({
    slides,
    saveSlide,
    onError: handleEditorError,
  });

  const activeSlide = editor.activeSlide;
  const activeIndex = editor.activeSlideIndex;
  const currentSlides = editor.state.slides;
  const snapshotSync = usePresentationSnapshotSync({
    projectId,
    projectRevision: payload?.project.revision,
    snapshotRevision: payload?.project.snapshotRevision,
    snapshotKind: payload?.project.snapshotKind,
    slides: currentSlides,
    assetUrls,
    filename,
    enabled: !readOnly && Boolean(payload) && !editor.hasPendingSaves,
    onError: handleSnapshotError,
  });
  const stageContext = () => {
    if (!payload || !activeSlide || editor.hasPendingSaves || !onStageContext) return;
    const elementId = mode === "view" ? undefined : editor.state.selectedElementId ?? undefined;
    onStageContext({
      context: {
        projectId,
        projectRevision: payload.project.revision,
        slideId: activeSlide.slideId,
        slideRevision: activeSlide.revision,
        ...(elementId ? { elementId } : {}),
      },
      label: `${filename} · Slide ${activeIndex + 1}${elementId ? ` · ${elementId}` : ""}`,
    });
  };

  const exportPptx = async () => {
    if (currentSlides.length === 0 || exporting) return;
    setExporting(true);
    setError(null);
    try {
      const rendered = await renderSlidesForExport(currentSlides, document, assetUrls);
      try {
        const result = await presentationExporter.exportPresentation({
          slideRoots: rendered.roots,
          suggestedFileName: filename,
        });
        downloadPresentation(result.blob, result.fileName);
      } finally {
        rendered.cleanup();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The PowerPoint export failed.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <aside
      data-testid="presentation-panel"
      className={`relative z-20 flex h-full w-full max-w-none shrink-0 flex-col border-l border-border/50 bg-background shadow-xl lg:w-[var(--presentation-panel-width)] ${isResizing ? "select-none" : ""}`}
      style={{ "--presentation-panel-width": `${panelWidth}px` } as CSSProperties}
    >
      <div
        {...resizeHandleProps}
        className="group absolute inset-y-0 left-0 z-30 hidden w-2 -translate-x-1 cursor-col-resize touch-none lg:block"
      >
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-primary/60 group-focus:bg-primary/60" />
      </div>
      <header className="flex min-h-[72px] items-center gap-3 border-b border-border/50 px-4 py-3">
        <div className={workspaceIconBlockClass("h-10 w-10")}><Presentation size={19} /></div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-foreground">{filename}</h2>
          <p className="mt-0.5 text-xs text-muted">
            {payload ? `${currentSlides.length} slides · Revision ${payload.project.revision}` : "Presentation"}
          </p>
        </div>
        <button type="button" onClick={() => void exportPptx()} disabled={exporting || currentSlides.length === 0}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-40"
          aria-label="Download PowerPoint" title="Download PowerPoint">
          <FileDown size={16} />
        </button>
        <button type="button" onClick={() => payload && printPresentation(currentSlides, payload.project.title, assetUrls)} disabled={!payload || currentSlides.length === 0}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-40"
          aria-label="Print or save as PDF" title="Print or save as PDF">
          <Printer size={16} />
        </button>
        <button type="button" onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground"
          aria-label="Close presentation preview"><X size={16} /></button>
      </header>

      <div className="flex items-center justify-between gap-3 border-b border-border/40 px-4 py-2">
        {readOnly ? (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/30 bg-surface-2/40 px-2.5 text-xs text-muted">
            <Eye size={13} />Review only in Ideascape
          </span>
        ) : (
          <div className="flex rounded-lg border border-border/30 bg-surface-2/40 p-0.5" aria-label="Presentation interaction mode">
            <button type="button" className={modeButtonClass(mode === "view")} aria-pressed={mode === "view"}
              onClick={() => { setMode("view"); editor.selectElement(null); }}><Eye size={13} />View</button>
            <button type="button" className={modeButtonClass(mode === "select")} aria-pressed={mode === "select"}
              onClick={() => setMode("select")}><MousePointer2 size={13} />Select</button>
            <button type="button" className={modeButtonClass(mode === "edit")} aria-pressed={mode === "edit"}
              onClick={() => setMode("edit")}><Pencil size={13} />Edit</button>
          </div>
        )}
        <span className="truncate text-[11px] text-muted">
          {editor.hasPendingSaves ? "Saving…" : snapshotSync.isSyncing ? "Refreshing PowerPoint…" : editor.state.selectedElementId ? `Selected: ${editor.state.selectedElementId}` : "No element selected"}
        </span>
      </div>

      {payload === undefined ? (
        <div className="grid min-h-0 flex-1 place-items-center text-sm text-muted">Opening presentation…</div>
      ) : payload === null || !activeSlide ? (
        <div className="grid min-h-0 flex-1 place-items-center px-6 text-center text-sm text-muted">This presentation is unavailable.</div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <PresentationSlideRail
            slides={currentSlides}
            activeSlideId={activeSlide.slideId}
            assetUrls={assetUrls}
            collapsed={slideRailCollapsed}
            onToggleCollapsed={() => setSlideRailCollapsed((current) => !current)}
            onSelect={editor.selectSlide}
          />
          <div className="flex min-w-0 flex-1 flex-col p-4">
            <div className="aspect-video w-full overflow-hidden rounded-md border border-border/40 bg-black shadow-sm">
              <SlideFrame
                slide={activeSlide}
                interactionMode={readOnly ? "view" : mode}
                selectedElementId={editor.state.selectedElementId}
                onSelect={editor.selectElement}
                onChange={!readOnly && mode === "edit" ? editor.replaceActiveHtml : undefined}
                assetUrls={assetUrls}
              />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-foreground">{activeSlide.title}</p>
                <p className="text-[11px] text-muted">Slide {activeIndex + 1} of {currentSlides.length}</p>
              </div>
              {onStageContext && !readOnly && (
                <button type="button" onClick={stageContext} disabled={editor.hasPendingSaves}
                  className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
                  <MessageSquare size={14} />Ask in chat
                </button>
              )}
            </div>
            {!readOnly && mode === "select" && <p className="mt-3 text-xs text-muted">Select an element to give the next chat message precise context. Selection does not change the slide.</p>}
            {!readOnly && mode === "edit" && <p className="mt-3 text-xs text-muted">Double-click text to edit, or drag selected elements. Changes save to this presentation.</p>}
            {error && <p className="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>}
          </div>
        </div>
      )}
    </aside>
  );
}
