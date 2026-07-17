import { startSlidePointerSession } from "./slidePointerSession";

interface SlideElementPointerSessionOptions {
  document: Document;
  element: HTMLElement;
  resizeHandle: HTMLElement | null;
  event: PointerEvent;
  scale: number;
  onCommit: () => void;
}

interface ElementGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
}

function numericStyle(
  element: HTMLElement,
  property: "left" | "top" | "width" | "height",
): number {
  const value = element.ownerDocument.defaultView?.getComputedStyle(element)[property] ?? "0";
  return Number.parseFloat(value) || 0;
}

function makeAbsolutelyPositioned(element: HTMLElement, scale: number): void {
  const view = element.ownerDocument.defaultView;
  const root = element.closest<HTMLElement>(".slide-root");
  if (!view || !root || view.getComputedStyle(element).position === "absolute") return;
  const elementRect = element.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  Object.assign(element.style, {
    position: "absolute",
    left: `${(elementRect.left - rootRect.left) / scale}px`,
    top: `${(elementRect.top - rootRect.top) / scale}px`,
    width: `${elementRect.width / scale}px`,
    height: `${elementRect.height / scale}px`,
    margin: "0",
  });
}

function elementGeometry(element: HTMLElement): ElementGeometry {
  return {
    left: numericStyle(element, "left"),
    top: numericStyle(element, "top"),
    width: numericStyle(element, "width"),
    height: numericStyle(element, "height"),
  };
}

export function positionResizeHandle(document: Document, element: HTMLElement): void {
  let handle = document.querySelector<HTMLElement>("[data-nanth-resize-handle]");
  if (!handle) {
    handle = document.createElement("div");
    handle.setAttribute("data-nanth-resize-handle", "true");
    document.body.appendChild(handle);
  }
  const rect = element.getBoundingClientRect();
  handle.style.left = `${rect.right - 7}px`;
  handle.style.top = `${rect.bottom - 7}px`;
}

export function startSlideElementPointerSession({
  document,
  element,
  resizeHandle,
  event,
  scale,
  onCommit,
}: SlideElementPointerSessionOptions): () => void {
  const startX = event.clientX;
  const startY = event.clientY;
  let initial: ElementGeometry | undefined;
  return startSlidePointerSession({
    document,
    captureTarget: resizeHandle ?? element,
    pointerId: event.pointerId,
    onMove: (moveEvent) => {
      const deltaX = (moveEvent.clientX - startX) / scale;
      const deltaY = (moveEvent.clientY - startY) / scale;
      if (!initial) {
        if (Math.hypot(deltaX, deltaY) < 3) return;
        makeAbsolutelyPositioned(element, scale);
        initial = elementGeometry(element);
      }
      moveEvent.preventDefault();
      if (resizeHandle) {
        element.style.width = `${Math.max(24, initial.width + deltaX)}px`;
        element.style.height = `${Math.max(24, initial.height + deltaY)}px`;
      } else {
        element.style.left = `${initial.left + deltaX}px`;
        element.style.top = `${initial.top + deltaY}px`;
      }
      positionResizeHandle(document, element);
    },
    onFinish: () => {
      if (initial) onCommit();
    },
  });
}
