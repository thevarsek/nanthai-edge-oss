import { afterEach, describe, expect, it, vi } from "vitest";
import { startSlidePointerSession } from "./slidePointerSession";

function pointerEvent(type: string, pointerId: number, clientX = 0): PointerEvent {
  const event = new Event(type) as PointerEvent;
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    clientX: { value: clientX },
  });
  return event;
}

function captureTarget(): { element: HTMLElement; release: ReturnType<typeof vi.fn> } {
  const element = document.createElement("div");
  let captured = false;
  const release = vi.fn(() => { captured = false; });
  Object.defineProperties(element, {
    setPointerCapture: { value: vi.fn(() => { captured = true; }) },
    hasPointerCapture: { value: vi.fn(() => captured) },
    releasePointerCapture: { value: release },
  });
  document.body.appendChild(element);
  return { element, release };
}

afterEach(() => document.body.replaceChildren());

describe("startSlidePointerSession", () => {
  it("tracks only its pointer and finishes cleanly on pointer cancellation", () => {
    const target = captureTarget();
    const onMove = vi.fn();
    const onFinish = vi.fn();
    startSlidePointerSession({
      document,
      captureTarget: target.element,
      pointerId: 7,
      onMove,
      onFinish,
    });

    document.dispatchEvent(pointerEvent("pointermove", 8, 20));
    document.dispatchEvent(pointerEvent("pointermove", 7, 30));
    document.dispatchEvent(pointerEvent("pointercancel", 7));
    document.dispatchEvent(pointerEvent("pointermove", 7, 40));

    expect(onMove).toHaveBeenCalledOnce();
    expect(onMove.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ clientX: 30 }));
    expect(onFinish).toHaveBeenCalledOnce();
    expect(target.release).toHaveBeenCalledWith(7);
  });

  it("finishes when the iframe window loses focus", () => {
    const target = captureTarget();
    const onFinish = vi.fn();
    startSlidePointerSession({
      document,
      captureTarget: target.element,
      pointerId: 3,
      onMove: vi.fn(),
      onFinish,
    });

    window.dispatchEvent(new Event("blur"));
    expect(onFinish).toHaveBeenCalledOnce();
  });

  it("removes listeners without committing when its owner unmounts", () => {
    const target = captureTarget();
    const onFinish = vi.fn();
    const cleanup = startSlidePointerSession({
      document,
      captureTarget: target.element,
      pointerId: 5,
      onMove: vi.fn(),
      onFinish,
    });

    cleanup();
    document.dispatchEvent(pointerEvent("pointerup", 5));
    expect(onFinish).not.toHaveBeenCalled();
  });
});
