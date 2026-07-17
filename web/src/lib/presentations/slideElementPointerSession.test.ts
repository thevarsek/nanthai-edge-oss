import { afterEach, describe, expect, it, vi } from "vitest";
import { startSlideElementPointerSession } from "./slideElementPointerSession";

function pointerEvent(type: string, pointerId: number, x: number, y: number): PointerEvent {
  const event = new Event(type, { cancelable: true }) as PointerEvent;
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    clientX: { value: x },
    clientY: { value: y },
  });
  return event;
}

function slideElement(): HTMLElement {
  const root = document.createElement("section");
  root.className = "slide-root";
  const element = document.createElement("p");
  element.style.cssText = "position:absolute;left:10px;top:20px;width:100px;height:40px";
  Object.defineProperties(element, {
    setPointerCapture: { value: vi.fn() },
    hasPointerCapture: { value: vi.fn(() => false) },
    releasePointerCapture: { value: vi.fn() },
  });
  root.appendChild(element);
  document.body.appendChild(root);
  return element;
}

afterEach(() => document.body.replaceChildren());

describe("startSlideElementPointerSession", () => {
  it("does not mutate or commit a click or double-click without movement", () => {
    const element = slideElement();
    const onCommit = vi.fn();
    startSlideElementPointerSession({
      document,
      element,
      resizeHandle: null,
      event: pointerEvent("pointerdown", 1, 20, 20),
      scale: 1,
      onCommit,
    });

    document.dispatchEvent(pointerEvent("pointerup", 1, 20, 20));
    expect(element.style.left).toBe("10px");
    expect(element.style.top).toBe("20px");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("moves and commits only after crossing the drag threshold", () => {
    const element = slideElement();
    const onCommit = vi.fn();
    startSlideElementPointerSession({
      document,
      element,
      resizeHandle: null,
      event: pointerEvent("pointerdown", 2, 20, 20),
      scale: 1,
      onCommit,
    });

    document.dispatchEvent(pointerEvent("pointermove", 2, 21, 21));
    expect(element.style.left).toBe("10px");
    document.dispatchEvent(pointerEvent("pointermove", 2, 30, 32));
    document.dispatchEvent(pointerEvent("pointerup", 2, 30, 32));

    expect(element.style.left).toBe("20px");
    expect(element.style.top).toBe("32px");
    expect(onCommit).toHaveBeenCalledOnce();
  });
});
