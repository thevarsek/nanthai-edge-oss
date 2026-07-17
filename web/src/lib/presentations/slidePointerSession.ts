interface SlidePointerSessionOptions {
  document: Document;
  captureTarget: Element;
  pointerId: number;
  onMove: (event: PointerEvent) => void;
  onFinish: () => void;
}

export function startSlidePointerSession({
  document,
  captureTarget,
  pointerId,
  onMove,
  onFinish,
}: SlidePointerSessionOptions): () => void {
  const frameWindow = document.defaultView;
  let active = true;

  const handleMove = (event: PointerEvent) => {
    if (event.pointerId === pointerId) onMove(event);
  };
  const cleanup = () => {
    if (!active) return;
    active = false;
    document.removeEventListener("pointermove", handleMove);
    document.removeEventListener("pointerup", handleFinish);
    document.removeEventListener("pointercancel", handleFinish);
    captureTarget.removeEventListener("lostpointercapture", handleFinish);
    frameWindow?.removeEventListener("blur", handleFinish);
    try {
      if (captureTarget.hasPointerCapture(pointerId)) {
        captureTarget.releasePointerCapture(pointerId);
      }
    } catch {
      // The frame or pointer may already have been detached.
    }
  };
  const handleFinish = (event?: Event) => {
    if (event && "pointerId" in event && (event as PointerEvent).pointerId !== pointerId) return;
    if (!active) return;
    cleanup();
    onFinish();
  };

  document.addEventListener("pointermove", handleMove);
  document.addEventListener("pointerup", handleFinish);
  document.addEventListener("pointercancel", handleFinish);
  captureTarget.addEventListener("lostpointercapture", handleFinish);
  frameWindow?.addEventListener("blur", handleFinish);
  try {
    captureTarget.setPointerCapture(pointerId);
  } catch {
    // Capture can fail when the source pointer is no longer active.
  }

  return cleanup;
}
