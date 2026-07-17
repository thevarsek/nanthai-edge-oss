import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

export const PRESENTATION_PANEL_MIN_WIDTH = 480;
export const PRESENTATION_PANEL_MAX_WIDTH = 960;
export const PRESENTATION_PANEL_DEFAULT_WIDTH = 640;
const MIN_CHAT_WIDTH = 360;

export function clampPresentationPanelWidth(width: number, viewportWidth: number): number {
  const viewportMaximum = Math.max(
    PRESENTATION_PANEL_MIN_WIDTH,
    viewportWidth - MIN_CHAT_WIDTH,
  );
  const maximum = Math.min(PRESENTATION_PANEL_MAX_WIDTH, viewportMaximum);
  return Math.min(maximum, Math.max(PRESENTATION_PANEL_MIN_WIDTH, Math.round(width)));
}

export function useResizablePresentationPanel() {
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1440 : window.innerWidth,
  );
  const [panelWidth, setPanelWidth] = useState(() =>
    clampPresentationPanelWidth(PRESENTATION_PANEL_DEFAULT_WIDTH, viewportWidth),
  );
  const [isResizing, setIsResizing] = useState(false);
  const dragStart = useRef<{ x: number; width: number; pointerId: number } | null>(null);

  useEffect(() => {
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
      setPanelWidth((current) => clampPresentationPanelWidth(current, window.innerWidth));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const maximumWidth = clampPresentationPanelWidth(PRESENTATION_PANEL_MAX_WIDTH, viewportWidth);
  const setClampedWidth = useCallback((width: number) => {
    setPanelWidth(clampPresentationPanelWidth(width, viewportWidth));
  }, [viewportWidth]);

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (viewportWidth < 1024) return;
    dragStart.current = { x: event.clientX, width: panelWidth, pointerId: event.pointerId };
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setIsResizing(true);
    event.preventDefault();
  }, [panelWidth, viewportWidth]);

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    setClampedWidth(start.width + start.x - event.clientX);
  }, [setClampedWidth]);

  const finishPointerResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    if (
      typeof event.currentTarget.hasPointerCapture === "function" &&
      typeof event.currentTarget.releasePointerCapture === "function" &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStart.current = null;
    setIsResizing(false);
  }, []);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    let nextWidth: number | undefined;
    if (event.key === "ArrowLeft") nextWidth = panelWidth + 24;
    if (event.key === "ArrowRight") nextWidth = panelWidth - 24;
    if (event.key === "Home") nextWidth = PRESENTATION_PANEL_MIN_WIDTH;
    if (event.key === "End") nextWidth = maximumWidth;
    if (nextWidth === undefined) return;
    event.preventDefault();
    setClampedWidth(nextWidth);
  }, [maximumWidth, panelWidth, setClampedWidth]);

  const resizeHandleProps = useMemo(() => ({
    role: "separator" as const,
    "aria-label": "Resize presentation panel",
    "aria-orientation": "vertical" as const,
    "aria-valuemin": PRESENTATION_PANEL_MIN_WIDTH,
    "aria-valuemax": maximumWidth,
    "aria-valuenow": panelWidth,
    tabIndex: 0,
    onPointerDown,
    onPointerMove,
    onPointerUp: finishPointerResize,
    onPointerCancel: finishPointerResize,
    onKeyDown,
  }), [finishPointerResize, maximumWidth, onKeyDown, onPointerDown, onPointerMove, panelWidth]);

  return { panelWidth, isResizing, resizeHandleProps };
}
