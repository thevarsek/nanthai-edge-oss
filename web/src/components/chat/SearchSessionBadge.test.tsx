import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { SearchSession, SearchSessionStatus } from "@/hooks/useSearchSessions";
import { SearchSessionBadge } from "./SearchSessionBadge";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function session(status: SearchSessionStatus): SearchSession {
  return {
    _id: `session_${status}` as Id<"searchSessions">,
    _creationTime: 1,
    chatId: "chat_1" as Id<"chats">,
    assistantMessageId: "message_1" as Id<"messages">,
    query: "research",
    mode: "paper",
    complexity: 2,
    status,
    progress: 100,
    currentPhase: status,
    phaseOrder: 1,
    startedAt: 1,
  };
}

describe("SearchSessionBadge", () => {
  it("renders terminal and fallback search phase badges", () => {
    const { rerender } = render(<SearchSessionBadge session={session("completed")} />);
    expect(screen.getByText("search_phase_completed")).toBeInTheDocument();

    rerender(<SearchSessionBadge session={session("failed")} />);
    expect(screen.getByText("search_phase_failed")).toBeInTheDocument();

    rerender(<SearchSessionBadge session={session("cancelled")} />);
    expect(screen.getByText("search_phase_cancelled")).toBeInTheDocument();

    rerender(<SearchSessionBadge session={session("planning")} />);
    expect(screen.getByText("search_phase_planning")).toBeInTheDocument();
  });
});
