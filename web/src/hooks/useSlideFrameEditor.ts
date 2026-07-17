import { useCallback, useEffect, useRef, type RefObject } from "react";
import { scaleSlideFrame, serializeSlideFrame } from "@/lib/presentations/slideFrameDocument";
import {
  positionResizeHandle,
  startSlideElementPointerSession,
} from "@/lib/presentations/slideElementPointerSession";

type ElementKind = "text" | "shape";

interface SlideFrameEditorOptions {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  interactive: boolean;
  editable: boolean;
  selectedElementId: string | null;
  onSelect: (elementId: string | null) => void;
  onCommit: (html: string) => void;
}

export interface SlideFrameCommands {
  addElement(kind: ElementKind): void;
  updateSelectedStyle(property: string, value: string): void;
  deleteSelected(): void;
  serialize(): string;
}

function generatedElementId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `element-${crypto.randomUUID()}`;
  }
  return `element-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function selectedElement(document: Document): HTMLElement | null {
  return document.querySelector<HTMLElement>(".nanth-selected[data-element-id]");
}

function eventElement(target: EventTarget | null): Element | null {
  const candidate = target as { nodeType?: number } | null;
  return candidate?.nodeType === 1 ? target as Element : null;
}

function removeSelection(document: Document): void {
  document.querySelectorAll(".nanth-selected, .nanth-selection-only").forEach((element) => {
    element.classList.remove("nanth-selected");
    element.classList.remove("nanth-selection-only");
    if (!element.getAttribute("class")?.trim()) element.removeAttribute("class");
  });
  document.querySelectorAll("[data-nanth-resize-handle]").forEach((element) => element.remove());
}

function applySelection(document: Document, elementId: string | null, showResizeHandle = true): void {
  removeSelection(document);
  if (!elementId) return;
  const element = Array.from(document.querySelectorAll<HTMLElement>("[data-element-id]"))
    .find((candidate) => candidate.dataset.elementId === elementId);
  if (!element) return;
  element.classList.add("nanth-selected");
  if (!showResizeHandle) element.classList.add("nanth-selection-only");
  if (showResizeHandle) positionResizeHandle(document, element);
}

export function useSlideFrameEditor({
  iframeRef, interactive, editable, selectedElementId, onSelect, onCommit,
}: SlideFrameEditorOptions): { onLoad: () => void; commands: SlideFrameCommands } {
  const documentRef = useRef<Document | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const pointerCleanupRef = useRef<(() => void) | null>(null);
  const scaleRef = useRef(1);
  const selectedIdRef = useRef(selectedElementId);

  useEffect(() => {
    selectedIdRef.current = selectedElementId;
  }, [selectedElementId]);

  const commit = useCallback(() => {
    const document = documentRef.current;
    if (!document) return;
    const html = serializeSlideFrame(document);
    if (html) onCommit(html);
    applySelection(document, selectedIdRef.current, editable);
  }, [editable, onCommit]);

  const onLoad = useCallback(() => {
    cleanupRef.current?.();
    const iframe = iframeRef.current;
    const document = iframe?.contentDocument ?? null;
    if (!iframe || !document) return;
    documentRef.current = document;
    scaleRef.current = scaleSlideFrame(document, iframe.clientWidth);
    applySelection(document, selectedIdRef.current, editable);

    const ResizeObserverConstructor = typeof ResizeObserver === "undefined" ? null : ResizeObserver;
    const resizeObserver = ResizeObserverConstructor ? new ResizeObserverConstructor(() => {
      scaleRef.current = scaleSlideFrame(document, iframe.clientWidth);
      const element = selectedElement(document);
      if (editable && element) positionResizeHandle(document, element);
    }) : null;
    resizeObserver?.observe(iframe);

    if (!interactive) {
      cleanupRef.current = () => resizeObserver?.disconnect();
      return;
    }

    const handleClick = (event: MouseEvent) => {
      const target = eventElement(event.target)?.closest<HTMLElement>("[data-element-id]") ?? null;
      const elementId = target?.dataset.elementId ?? null;
      onSelect(elementId);
      applySelection(document, elementId, editable);
    };

    const handleDoubleClick = (event: MouseEvent) => {
      const target = eventElement(event.target)?.closest<HTMLElement>("[data-element-id]") ?? null;
      const tag = target?.tagName.toLowerCase();
      if (!target || tag === "img" || tag === "svg") return;
      target.setAttribute("contenteditable", "true");
      target.focus();
    };

    const handleFocusOut = (event: FocusEvent) => {
      const target = eventElement(event.target) as HTMLElement | null;
      if (!target || target.contentEditable !== "true") return;
      target.removeAttribute("contenteditable");
      commit();
    };

    const handlePointerDown = (event: PointerEvent) => {
      const eventTarget = event.target;
      const targetElement = eventElement(eventTarget);
      const resizeHandle = targetElement?.closest<HTMLElement>("[data-nanth-resize-handle]") ?? null;
      const element = resizeHandle ? selectedElement(document) : (
        targetElement?.closest<HTMLElement>(".nanth-selected[data-element-id]") ?? null
      );
      if (!element || element.contentEditable === "true") return;

      pointerCleanupRef.current?.();
      pointerCleanupRef.current = startSlideElementPointerSession({
        document,
        element,
        resizeHandle,
        event,
        scale: scaleRef.current,
        onCommit: () => {
          pointerCleanupRef.current = null;
          commit();
        },
      });
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onSelect(null);
        applySelection(document, null);
      }
      if (editable && (event.key === "Backspace" || event.key === "Delete") && selectedElement(document)) {
        const element = selectedElement(document);
        if (element?.contentEditable === "true") return;
        event.preventDefault();
        element?.remove();
        onSelect(null);
        commit();
      }
    };

    document.addEventListener("click", handleClick);
    if (editable) {
      document.addEventListener("dblclick", handleDoubleClick);
      document.addEventListener("focusout", handleFocusOut);
      document.addEventListener("pointerdown", handlePointerDown);
    }
    document.addEventListener("keydown", handleKeyDown);
    cleanupRef.current = () => {
      pointerCleanupRef.current?.();
      pointerCleanupRef.current = null;
      resizeObserver?.disconnect();
      document.removeEventListener("click", handleClick);
      if (editable) {
        document.removeEventListener("dblclick", handleDoubleClick);
        document.removeEventListener("focusout", handleFocusOut);
        document.removeEventListener("pointerdown", handlePointerDown);
      }
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [commit, editable, iframeRef, interactive, onSelect]);

  useEffect(() => {
    const document = documentRef.current;
    if (document) applySelection(document, selectedElementId, editable);
  }, [editable, selectedElementId]);

  useEffect(() => {
    const document = documentRef.current;
    if (document && iframeRef.current?.contentDocument === document) onLoad();
  }, [iframeRef, onLoad]);

  useEffect(() => () => cleanupRef.current?.(), []);

  const commands: SlideFrameCommands = {
    addElement(kind) {
      if (!editable) return;
      const document = documentRef.current;
      const root = document?.querySelector<HTMLElement>(".slide-root");
      if (!document || !root) return;
      const element = document.createElement("div");
      const elementId = generatedElementId();
      element.dataset.elementId = elementId;
      Object.assign(element.style, {
        position: "absolute",
        left: "120px",
        top: "120px",
        width: kind === "shape" ? "260px" : "420px",
        height: kind === "text" ? "96px" : "220px",
      });
      if (kind === "text") {
        element.textContent = "Double-click to edit";
        Object.assign(element.style, { fontSize: "44px", fontWeight: "650", color: "#111111" });
      } else if (kind === "shape") {
        Object.assign(element.style, { background: "#ff5f3d", borderRadius: "16px" });
      }
      root.appendChild(element);
      selectedIdRef.current = elementId;
      onSelect(elementId);
      applySelection(document, elementId);
      commit();
    },
    updateSelectedStyle(property, value) {
      if (!editable) return;
      const document = documentRef.current;
      const element = document ? selectedElement(document) : null;
      if (!document || !element) return;
      element.style.setProperty(property, value);
      positionResizeHandle(document, element);
      commit();
    },
    deleteSelected() {
      if (!editable) return;
      const document = documentRef.current;
      const element = document ? selectedElement(document) : null;
      if (!element) return;
      element.remove();
      onSelect(null);
      commit();
    },
    serialize() {
      return documentRef.current ? serializeSlideFrame(documentRef.current) : "";
    },
  };

  return { onLoad, commands };
}
