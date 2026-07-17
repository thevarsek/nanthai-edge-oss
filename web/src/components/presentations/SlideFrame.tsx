import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { useSlideFrameEditor, type SlideFrameCommands } from "@/hooks/useSlideFrameEditor";
import { buildSlideFrameDocument } from "@/lib/presentations/slideFrameDocument";
import type { PresentationSlideRecord } from "@/lib/presentations/types";
import type { PresentationAssetUrls } from "@/lib/presentations/types";

interface SlideFrameProps {
  slide: PresentationSlideRecord;
  interactive?: boolean;
  interactionMode?: "view" | "select" | "edit";
  selectedElementId?: string | null;
  className?: string;
  title?: string;
  onSelect?: (elementId: string | null) => void;
  onChange?: (html: string) => void;
  assetUrls?: PresentationAssetUrls;
}

const ignoreSelection = () => undefined;
const ignoreChange = () => undefined;

export const SlideFrame = forwardRef<SlideFrameCommands, SlideFrameProps>(
  function SlideFrame({
    slide,
    interactive = false,
    interactionMode,
    selectedElementId = null,
    className = "",
    title,
    onSelect = ignoreSelection,
    onChange = ignoreChange,
    assetUrls = {},
  }, forwardedRef) {
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const srcDoc = useMemo(
      () => buildSlideFrameDocument(slide.html, slide.slideId, assetUrls),
      [assetUrls, slide.html, slide.slideId],
    );
    const resolvedInteractionMode = interactionMode ?? (interactive ? "edit" : "view");
    const { onLoad, commands } = useSlideFrameEditor({
      iframeRef,
      interactive: resolvedInteractionMode !== "view",
      editable: resolvedInteractionMode === "edit",
      selectedElementId,
      onSelect,
      onCommit: onChange,
    });

    useImperativeHandle(forwardedRef, () => commands, [commands]);

    return (
      <iframe
        ref={iframeRef}
        className={`presentation-slide-iframe block h-full w-full border-0 bg-transparent ${className}`.trim()}
        title={title ?? `Slide ${slide.position + 1}: ${slide.title}`}
        srcDoc={srcDoc}
        sandbox="allow-same-origin"
        referrerPolicy="no-referrer"
        loading={resolvedInteractionMode !== "view" ? "eager" : "lazy"}
        tabIndex={resolvedInteractionMode !== "view" ? 0 : -1}
        onLoad={onLoad}
      />
    );
  },
);
