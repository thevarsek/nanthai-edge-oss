import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSlideFrameEditor } from "./useSlideFrameEditor";

function frameHarness(editable: boolean) {
  const frameDocument = document.implementation.createHTMLDocument("Slide");
  frameDocument.body.innerHTML = `
    <section class="slide-root" style="width:1280px;height:720px">
      <h1 data-element-id="headline">Headline</h1>
    </section>
  `;
  const iframe = {
    contentDocument: frameDocument,
    clientWidth: 640,
  } as HTMLIFrameElement;
  const onSelect = vi.fn();
  const onCommit = vi.fn();
  const { result } = renderHook(() => useSlideFrameEditor({
    iframeRef: { current: iframe },
    interactive: true,
    editable,
    selectedElementId: null,
    onSelect,
    onCommit,
  }));
  act(() => result.current.onLoad());
  return { frameDocument, onSelect, onCommit };
}

describe("useSlideFrameEditor interaction modes", () => {
  it("installs selection listeners when an already-loaded frame leaves View mode", () => {
    const frameDocument = document.implementation.createHTMLDocument("Slide");
    frameDocument.body.innerHTML = '<section class="slide-root"><h1 data-element-id="headline">Headline</h1></section>';
    const iframe = { contentDocument: frameDocument, clientWidth: 640 } as HTMLIFrameElement;
    const onSelect = vi.fn();
    const { result, rerender } = renderHook(({ interactive }) => useSlideFrameEditor({
      iframeRef: { current: iframe },
      interactive,
      editable: false,
      selectedElementId: null,
      onSelect,
      onCommit: vi.fn(),
    }), { initialProps: { interactive: false } });

    act(() => result.current.onLoad());
    rerender({ interactive: true });
    const headline = frameDocument.querySelector<HTMLElement>("[data-element-id='headline']");
    act(() => headline?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(onSelect).toHaveBeenCalledWith("headline");
  });

  it("selects without exposing resize affordances or mutating the slide in selection mode", () => {
    const { frameDocument, onSelect, onCommit } = frameHarness(false);
    const headline = frameDocument.querySelector<HTMLElement>("[data-element-id='headline']");

    act(() => headline?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => headline?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    act(() => headline?.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true })));

    expect(onSelect).toHaveBeenCalledWith("headline");
    expect(headline?.classList.contains("nanth-selected")).toBe(true);
    expect(frameDocument.querySelector("[data-nanth-resize-handle]")).toBeNull();
    expect(headline?.hasAttribute("contenteditable")).toBe(false);
    expect(frameDocument.querySelector("[data-element-id='headline']")).toBe(headline);
    expect(onCommit).not.toHaveBeenCalled();

    act(() => headline?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(headline?.hasAttribute("class")).toBe(false);
  });

  it("shows the resize affordance only when Edit is active", () => {
    const { frameDocument } = frameHarness(true);
    const headline = frameDocument.querySelector<HTMLElement>("[data-element-id='headline']");

    act(() => headline?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(frameDocument.querySelector("[data-nanth-resize-handle]")).not.toBeNull();
  });
});
