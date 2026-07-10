import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Connectors, MessageNode } from "./IdeascapeNodes";

vi.mock("@/components/chat/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock("@/components/shared/PersonaAvatar", () => ({
  PersonaAvatar: ({ personaName }: { personaName?: string }) => <span>avatar-{personaName}</span>,
}));

vi.mock("@/components/shared/ProviderLogo", () => ({
  ProviderLogo: ({ modelId }: { modelId: string }) => <span>logo-{modelId}</span>,
}));

vi.mock("@/components/chat/AdvisorBatchPanel", () => ({
  AdvisorBatchPanel: ({ batchId, compact }: { batchId: string; compact?: boolean }) => (
    <div data-testid="advisor-panel">{batchId}-{String(compact)}</div>
  ),
}));

function baseMessage(overrides: Record<string, unknown> = {}) {
  return {
    _id: "message_1",
    role: "assistant",
    content: "Body text",
    status: "complete",
    ...overrides,
  } as never;
}

function renderNode(overrides: Record<string, unknown> = {}, visualState = "default") {
  const handlers = {
    onPointerDown: vi.fn(),
    onResizePointerDown: vi.fn(),
    shouldSuppressClick: vi.fn(() => false),
    onSelect: vi.fn(),
    onFocus: vi.fn(),
  };
  render(
    <MessageNode
      message={baseMessage(overrides)}
      x={0}
      y={0}
      width={220}
      height={160}
      visualState={visualState as never}
      {...handlers}
    />,
  );
  return handlers;
}

describe("MessageNode", () => {
  it("focuses the message when clicking body content", () => {
    const { onFocus } = renderNode();

    fireEvent.click(screen.getByText("Body text"));

    expect(onFocus).toHaveBeenCalledWith("message_1");
  });

  it("renders participant, provider, user, and assistant fallbacks", () => {
    const { rerender } = render(
      <MessageNode
        message={baseMessage({ participantName: "Ada", participantAvatarImageUrl: "https://example.com/a.png" })}
        x={0}
        y={0}
        width={220}
        height={160}
        visualState="focused"
        onPointerDown={vi.fn()}
        onResizePointerDown={vi.fn()}
        onSelect={vi.fn()}
        onFocus={vi.fn()}
      />,
    );
    expect(screen.getByText("avatar-Ada")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Focus")).toBeInTheDocument();

    rerender(
      <MessageNode
        message={baseMessage({ modelId: "anthropic/claude-sonnet" })}
        x={0}
        y={0}
        width={220}
        height={160}
        visualState="activeBranch"
        onPointerDown={vi.fn()}
        onResizePointerDown={vi.fn()}
        onSelect={vi.fn()}
        onFocus={vi.fn()}
      />,
    );
    expect(screen.getByText("logo-anthropic/claude-sonnet")).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet")).toBeInTheDocument();

    rerender(
      <MessageNode
        message={baseMessage({ role: "user", content: "" })}
        x={0}
        y={0}
        width={220}
        height={100}
        visualState="default"
        onPointerDown={vi.fn()}
        onResizePointerDown={vi.fn()}
        onSelect={vi.fn()}
        onFocus={vi.fn()}
      />,
    );
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("empty")).toBeInTheDocument();
  });

  it("renders media previews, overflow count, pending content, and selected toggle semantics", () => {
    const { onSelect, onFocus, onResizePointerDown } = renderNode({
      content: "",
      status: "streaming",
      imageUrls: ["https://example.com/1.png", "https://example.com/2.png", "https://example.com/3.png", "https://example.com/4.png"],
      imageGenerationResult: { requestedCount: 5, generatedCount: 4, failedCount: 1 },
      videoUrls: ["https://example.com/video.mp4"],
    }, "selected");

    expect(screen.getAllByAltText("Generated")).toHaveLength(3);
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("Generated 4 of 5 images.")).toBeInTheDocument();
    expect(screen.getByText("Video")).toBeInTheDocument();
    expect(screen.getByText("...")).toBeInTheDocument();
    expect(screen.getByText("Context")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Remove from context"));
    expect(onSelect).toHaveBeenCalledWith("message_1", true);
    expect(onFocus).not.toHaveBeenCalled();

    fireEvent.pointerDown(screen.getByTitle("Resize card"), { pointerId: 1 });
    expect(onResizePointerDown).toHaveBeenCalledWith(expect.anything(), "message_1");
  });

  it("uses friendly persisted generation errors in node previews", () => {
    renderNode({
      content: 'Error: {"code":"INTERNAL_ERROR","message":"Provider failed cleanly"}',
      status: "failed",
    });

    expect(screen.getByText("Provider failed cleanly")).toBeInTheDocument();
    expect(screen.queryByText(/"code":"INTERNAL_ERROR"/)).not.toBeInTheDocument();
  });

  it("shows a compact image placeholder for pending image-generation nodes", () => {
    render(
      <MessageNode
        message={baseMessage({ content: "", status: "pending", modelId: "openai/gpt-image-2" })}
        x={0}
        y={0}
        width={220}
        height={160}
        visualState="default"
        isImageGeneration
        onPointerDown={vi.fn()}
        onResizePointerDown={vi.fn()}
        onSelect={vi.fn()}
        onFocus={vi.fn()}
      />,
    );

    const placeholder = screen.getByRole("status", { name: "Generating image..." });
    expect(placeholder).toHaveClass("w-20");
    expect(placeholder.firstElementChild).toHaveClass("aspect-square");
    expect(screen.queryByText("...")).not.toBeInTheDocument();
  });

  it("uses the backend-adapted pending image count in Ideascape", () => {
    render(
      <MessageNode
        message={baseMessage({
          content: "",
          status: "pending",
          modelId: "openai/gpt-image-2",
          imageGenerationExpectedCount: 2,
          retryContract: {
            participants: [{ modelId: "openai/gpt-image-2" }],
            searchMode: "none",
            imageConfig: { count: 10 },
          },
        })}
        x={0} y={0} width={220} height={160} visualState="default"
        isImageGeneration
        onPointerDown={vi.fn()} onResizePointerDown={vi.fn()} onSelect={vi.fn()} onFocus={vi.fn()}
      />,
    );

    expect(screen.getByRole("status", { name: "Generating 2 images..." })).toBeInTheDocument();
  });

  it("shows Advisor details only on the canonical Ideascape node", () => {
    const { rerender } = render(
      <MessageNode
        message={baseMessage({ advisorBatchId: "advisor_batch_1" })}
        x={0} y={0} width={220} height={160} visualState="default"
        showAdvisorPanel
        onPointerDown={vi.fn()} onResizePointerDown={vi.fn()} onSelect={vi.fn()} onFocus={vi.fn()}
      />,
    );
    expect(screen.getByTestId("advisor-panel")).toHaveTextContent("advisor_batch_1-true");

    rerender(
      <MessageNode
        message={baseMessage({ advisorBatchId: "advisor_batch_1" })}
        x={0} y={0} width={220} height={160} visualState="default"
        showAdvisorPanel={false}
        onPointerDown={vi.fn()} onResizePointerDown={vi.fn()} onSelect={vi.fn()} onFocus={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("advisor-panel")).not.toBeInTheDocument();
  });

  it("toggles selection with modifiers and suppresses post-drag clicks", () => {
    const handlers = renderNode({}, "default");

    fireEvent.click(screen.getByText("Body text"), { shiftKey: true });
    expect(handlers.onSelect).toHaveBeenCalledWith("message_1", true);
    expect(handlers.onFocus).not.toHaveBeenCalled();

    handlers.shouldSuppressClick.mockReturnValueOnce(true);
    fireEvent.click(screen.getByText("Body text"));
    expect(handlers.onFocus).not.toHaveBeenCalled();
  });
});

describe("Connectors", () => {
  it("draws active, context, and default connector paths only when positions exist", () => {
    const messages = [
      baseMessage({ _id: "parent" }),
      baseMessage({ _id: "active", parentMessageIds: ["parent"] }),
      baseMessage({ _id: "context", parentMessageIds: ["parent"] }),
      baseMessage({ _id: "default", parentMessageIds: ["missing", "parent"] }),
      baseMessage({ _id: "unplaced", parentMessageIds: ["parent"] }),
    ];

    const { container } = render(
      <Connectors
        messages={messages}
        posMap={new Map([
          ["parent", { x: 0, y: 0 }],
          ["active", { x: 0, y: 220 }],
          ["context", { x: 260, y: 220 }],
          ["default", { x: 520, y: 220 }],
        ])}
        sizeMap={new Map([["parent", { width: 220, height: 120 }]])}
        activeBranchIds={new Set(["parent", "active"])}
        contextBranchIds={new Set(["parent", "context"])}
        width={800}
        height={600}
      />,
    );

    const paths = Array.from(container.querySelectorAll("path"));
    expect(paths).toHaveLength(3);
    expect(paths.map((path) => path.getAttribute("stroke-width"))).toEqual(["1.8", "1.4", "1.5"]);
  });
});
