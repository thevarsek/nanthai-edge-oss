import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { BranchIndicator } from "./BranchIndicator";
import type { BranchNode } from "@/hooks/useBranching";

function messageId(id: string): Id<"messages"> {
  return id as Id<"messages">;
}

function branchNode(overrides: Partial<BranchNode> = {}): BranchNode {
  return {
    messageId: messageId("messages_2"),
    siblings: [messageId("messages_1"), messageId("messages_2"), messageId("messages_3")],
    activeIndex: 1,
    allOnPath: false,
    ...overrides,
  };
}

describe("BranchIndicator", () => {
  it("navigates switchable branch siblings and disables unavailable directions", () => {
    const onNavigate = vi.fn();
    render(<BranchIndicator node={branchNode()} onNavigate={onNavigate} />);

    expect(screen.getByText("Branch 2 of 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Previous branch" }));
    fireEvent.click(screen.getByRole("button", { name: "Next branch" }));

    expect(onNavigate).toHaveBeenNthCalledWith(1, messageId("messages_2"), "prev");
    expect(onNavigate).toHaveBeenNthCalledWith(2, messageId("messages_2"), "next");
  });

  it("jumps to the next merged branch sibling", () => {
    const onJumpToNext = vi.fn();
    render(
      <BranchIndicator
        node={branchNode({ allOnPath: true })}
        onNavigate={vi.fn()}
        onJumpToNext={onJumpToNext}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Jump to next branch" }));

    expect(onJumpToNext).toHaveBeenCalledWith(messageId("messages_3"));
  });

  it("does not submit an enclosing form from branch controls", () => {
    const onSubmit = vi.fn((event: React.FormEvent<HTMLFormElement>) => event.preventDefault());
    const onNavigate = vi.fn();
    const onJumpToNext = vi.fn();
    const { rerender } = render(
      <form onSubmit={onSubmit}>
        <BranchIndicator node={branchNode()} onNavigate={onNavigate} onJumpToNext={onJumpToNext} />
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Previous branch" }));
    fireEvent.click(screen.getByRole("button", { name: "Next branch" }));

    rerender(
      <form onSubmit={onSubmit}>
        <BranchIndicator
          node={branchNode({ allOnPath: true })}
          onNavigate={onNavigate}
          onJumpToNext={onJumpToNext}
        />
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Jump to next branch" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
