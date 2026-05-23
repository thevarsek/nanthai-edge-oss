import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { SearchSession } from "@/hooks/useSearchSessions";
import { ResearchProgressPanel } from "./ResearchProgressPanel";

function session(overrides: Partial<SearchSession> = {}): SearchSession {
  return {
    _id: "session_1" as Id<"searchSessions">,
    _creationTime: 1,
    chatId: "chat_1" as Id<"chats">,
    assistantMessageId: "message_1" as Id<"messages">,
    query: "query",
    mode: "web",
    complexity: 2,
    status: "searching",
    progress: 40,
    currentPhase: "searching",
    phaseOrder: 1,
    startedAt: Date.now(),
    ...overrides,
  };
}

describe("ResearchProgressPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-19T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows cancel only for active sessions and invokes it once", () => {
    const onCancel = vi.fn();

    render(<ResearchProgressPanel session={session()} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("hides cancel for completed sessions", () => {
    render(<ResearchProgressPanel session={session({ status: "completed" })} onCancel={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  });

  it("clamps the progress bar width and advances elapsed time while active", () => {
    const startedAt = Date.now() - 1_000;

    const { container } = render(
      <ResearchProgressPanel
        session={session({ progress: 140, startedAt })}
        onCancel={vi.fn()}
      />,
    );

    expect(container.querySelector(".h-full")).toHaveStyle({ width: "100%" });
    expect(screen.getByText("1s")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(screen.getByText("3s")).toBeInTheDocument();
  });
});
