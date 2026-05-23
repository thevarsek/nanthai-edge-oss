import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IdeascapeCanvas } from "./IdeascapeCanvas";
import { computeIdeascapeDisplayGeometry } from "./IdeascapeCanvasGeometry";

describe("computeIdeascapeDisplayGeometry", () => {
  it("keeps positive logical coordinates stable instead of normalizing them to the padding", () => {
    const geometry = computeIdeascapeDisplayGeometry(
      new Map([
        ["a", { x: 500, y: 300 }],
        ["b", { x: 760, y: 520 }],
      ]),
      new Map([
        ["a", { width: 220, height: 120 }],
        ["b", { width: 220, height: 120 }],
      ]),
    );

    expect(geometry.offsetX).toBe(180);
    expect(geometry.offsetY).toBe(80);
    expect(geometry.posMap.get("a")).toEqual({ x: 680, y: 380 });
    expect(geometry.posMap.get("b")).toEqual({ x: 940, y: 600 });
  });

  it("normalizes negative logical coordinates into padded canvas coordinates", () => {
    const geometry = computeIdeascapeDisplayGeometry(
      new Map([
        ["a", { x: -500, y: -300 }],
        ["b", { x: -240, y: -80 }],
      ]),
      new Map([
        ["a", { width: 220, height: 120 }],
        ["b", { width: 220, height: 120 }],
      ]),
    );

    expect(geometry.offsetX).toBe(680);
    expect(geometry.offsetY).toBe(380);
    expect(geometry.posMap.get("a")).toEqual({ x: 180, y: 80 });
    expect(geometry.posMap.get("b")).toEqual({ x: 440, y: 300 });
  });
});

describe("IdeascapeCanvas pointer interactions", () => {
  it("does not clear selection when normal lost pointer capture follows a completed pan", () => {
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    const onClearSelection = vi.fn();
    const { container } = render(
      <IdeascapeCanvas
        messages={[]}
        positions={[]}
        viewport={{ x: 0, y: 0, scale: 1 }}
        selectedIds={new Set()}
        focusedId={null}
        activeBranchIds={new Set()}
        contextBranchIds={new Set()}
        onViewportChange={vi.fn()}
        onNodeDragEnd={vi.fn()}
        onNodeResizeEnd={vi.fn()}
        onSelectNode={vi.fn()}
        onFocusNode={vi.fn()}
        onClearSelection={onClearSelection}
      />,
    );
    const canvas = container.firstElementChild as HTMLElement;

    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 40, clientY: 10 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 40, clientY: 10 });
    fireEvent.lostPointerCapture(canvas, { pointerId: 1 });
    fireEvent.click(canvas);

    expect(onClearSelection).not.toHaveBeenCalled();
  });
});
