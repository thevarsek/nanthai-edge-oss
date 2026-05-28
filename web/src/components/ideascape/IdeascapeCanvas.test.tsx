import { fireEvent, render } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { IdeascapeCanvas } from "./IdeascapeCanvas";
import { computeIdeascapeDisplayGeometry } from "./IdeascapeCanvasGeometry";

vi.mock("./IdeascapeNodes", async () => {
  const actual = await vi.importActual<typeof import("./IdeascapeNodes")>("./IdeascapeNodes");
  return {
    ...actual,
    MessageNode: ({ message, x, y, width, height, visualState, onPointerDown, onResizePointerDown, shouldSuppressClick, onSelect, onFocus }: {
      message: { _id: Id<"messages">; content?: string };
      x: number;
      y: number;
      width: number;
      height: number;
      visualState: string;
      onPointerDown: (event: ReactPointerEvent, id: Id<"messages">) => void;
      onResizePointerDown: (event: ReactPointerEvent, id: Id<"messages">) => void;
      shouldSuppressClick?: (id: Id<"messages">) => boolean;
      onSelect: (id: Id<"messages">, multi: boolean) => void;
      onFocus: (id: Id<"messages">) => void;
    }) => (
      <div
        data-node-shell
        data-visual-state={visualState}
        style={{ position: "absolute", left: x, top: y, width, height }}
        onPointerDown={(event) => onPointerDown(event, message._id)}
        onClick={(event) => {
          if (shouldSuppressClick?.(message._id)) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          onFocus(message._id);
        }}
      >
        <button type="button" onClick={(event) => { event.stopPropagation(); onSelect(message._id, true); }}>select-{message._id}</button>
        <button type="button" title={`resize-${message._id}`} onPointerDown={(event) => onResizePointerDown(event, message._id)}>resize</button>
        <div data-node-scroll>{message.content}</div>
      </div>
    ),
  };
});

function message(id: string, parentMessageIds?: string[]) {
  return {
    _id: id as Id<"messages">,
    role: "assistant",
    content: id,
    status: "completed",
    parentMessageIds,
  } as never;
}

function renderCanvas(overrides: Partial<Parameters<typeof IdeascapeCanvas>[0]> = {}) {
  const props = {
    messages: [message("message_1")],
    positions: [{
      _id: "position_1" as Id<"nodePositions">,
      messageId: "message_1" as Id<"messages">,
      x: 100,
      y: 100,
      width: 220,
      height: 140,
    }],
    viewport: { x: 0, y: 0, scale: 1 },
    selectedIds: new Set<Id<"messages">>(),
    focusedId: null,
    activeBranchIds: new Set<string>(),
    contextBranchIds: new Set<string>(),
    onViewportChange: vi.fn(),
    onNodeDragEnd: vi.fn(),
    onNodeResizeEnd: vi.fn(),
    onSelectNode: vi.fn(),
    onFocusNode: vi.fn(),
    onClearSelection: vi.fn(),
    ...overrides,
  };
  const view = render(<IdeascapeCanvas {...props} />);
  return { ...props, ...view };
}

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

  it("zooms around the pointer, ignores node-scroll wheel events, and clears on stationary canvas clicks", () => {
    const onViewportChange = vi.fn();
    const onClearSelection = vi.fn();
    const { container } = renderCanvas({ onViewportChange, onClearSelection });
    const canvas = container.firstElementChild as HTMLElement;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      left: 10,
      top: 20,
      right: 810,
      bottom: 620,
      width: 800,
      height: 600,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    });

    fireEvent.wheel(canvas, { deltaY: -100, clientX: 210, clientY: 220 });
    expect(onViewportChange).toHaveBeenCalledWith({ x: -16, y: -16, scale: 1.08 });

    fireEvent.wheel(container.querySelector("[data-node-scroll]")!, { deltaY: -100, clientX: 210, clientY: 220 });
    expect(onViewportChange).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.click(canvas);
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it("persists node drag and suppresses the click that follows the drag", () => {
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    const onNodeDragEnd = vi.fn();
    const onFocusNode = vi.fn();
    const { container } = renderCanvas({ onNodeDragEnd, onFocusNode });
    const canvas = container.firstElementChild as HTMLElement;
    const node = container.querySelector("[data-node-shell]") as HTMLElement;

    fireEvent.pointerDown(node, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 40, clientY: 30 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 40, clientY: 30 });
    fireEvent.click(node);

    expect(onNodeDragEnd).toHaveBeenCalledWith("message_1", 130, 120);
    expect(onFocusNode).not.toHaveBeenCalled();
  });

  it("previews and persists node resize while clamping minimum dimensions", () => {
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    const onNodeResizeEnd = vi.fn();
    const { container } = renderCanvas({ onNodeResizeEnd });
    const canvas = container.firstElementChild as HTMLElement;

    fireEvent.pointerDown(container.querySelector('[title="resize-message_1"]')!, {
      pointerId: 1,
      clientX: 50,
      clientY: 50,
    });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: -100, clientY: 20 });
    expect((container.querySelector("[data-node-shell]") as HTMLElement).style.width).toBe("180px");

    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: -100, clientY: 20 });
    expect(onNodeResizeEnd).toHaveBeenCalledWith("message_1", 180, 120);
  });

  it("prioritizes selected, focused, and active-branch visual states and routes multi-select", () => {
    const onSelectNode = vi.fn();
    const { container } = renderCanvas({
      messages: [message("selected"), message("focused"), message("active"), message("plain")],
      positions: [],
      selectedIds: new Set(["selected" as Id<"messages">]),
      focusedId: "focused" as Id<"messages">,
      activeBranchIds: new Set(["active"]),
      onSelectNode,
    });

    const nodeShells = Array.from(container.querySelectorAll("[data-node-shell]"));
    expect(nodeShells.map((node) => node.getAttribute("data-visual-state"))).toEqual([
      "selected",
      "focused",
      "activeBranch",
      "default",
    ]);

    fireEvent.click(container.querySelector("button")!);
    expect(onSelectNode).toHaveBeenCalledWith("selected", true);
  });

  it("cancels drag and resize interactions without persisting on pointer cancel", () => {
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    const onNodeDragEnd = vi.fn();
    const onNodeResizeEnd = vi.fn();
    const { container } = renderCanvas({ onNodeDragEnd, onNodeResizeEnd });
    const canvas = container.firstElementChild as HTMLElement;
    const node = container.querySelector("[data-node-shell]") as HTMLElement;

    fireEvent.pointerDown(node, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 40, clientY: 30 });
    fireEvent.pointerCancel(canvas, { pointerId: 1 });

    expect(onNodeDragEnd).not.toHaveBeenCalled();
    expect(node.style.transform).toBe("");

    fireEvent.pointerDown(container.querySelector('[title="resize-message_1"]')!, {
      pointerId: 2,
      clientX: 50,
      clientY: 50,
    });
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 120, clientY: 90 });
    expect(node.style.width).toBe("290px");

    fireEvent.pointerCancel(canvas, { pointerId: 2 });
    expect(onNodeResizeEnd).not.toHaveBeenCalled();
  });
});
