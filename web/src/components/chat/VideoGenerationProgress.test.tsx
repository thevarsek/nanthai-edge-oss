import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { VideoGenerationProgress } from "./VideoGenerationProgress";

const mockUseQuery = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

const messageId = "msg_video" as Id<"messages">;

describe("VideoGenerationProgress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T10:00:10Z"));
    mockUseQuery.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing for missing or completed jobs", () => {
    const { container, rerender } = render(<VideoGenerationProgress messageId={messageId} />);
    mockUseQuery.mockReturnValue(null);
    rerender(<VideoGenerationProgress messageId={messageId} />);
    expect(container).toBeEmptyDOMElement();

    mockUseQuery.mockReturnValue({ status: "completed", createdAt: Date.now() - 5_000 });
    rerender(<VideoGenerationProgress messageId={messageId} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders active jobs with status and elapsed time", () => {
    mockUseQuery.mockReturnValue({ status: "in_progress", createdAt: Date.now() - 10_000 });

    render(<VideoGenerationProgress messageId={messageId} />);

    expect(screen.getByText(/video generation/i)).toBeInTheDocument();
    expect(screen.getByText(/generating video/i)).toBeInTheDocument();
    expect(screen.getByText("10s")).toBeInTheDocument();
  });

  it("renders failed jobs with their backend error detail", () => {
    mockUseQuery.mockReturnValue({
      status: "failed",
      createdAt: Date.now() - 65_000,
      error: "Provider rejected the request",
    });

    render(<VideoGenerationProgress messageId={messageId} />);

    expect(screen.getByText(/video generation failed/i)).toBeInTheDocument();
    expect(screen.getByText("Provider rejected the request")).toBeInTheDocument();
    expect(screen.getByText("1m 5s")).toBeInTheDocument();
  });
});
