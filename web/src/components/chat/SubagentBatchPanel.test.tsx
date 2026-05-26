import type { FormEvent } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { useQuery } from "convex/react";
import { describe, expect, it, vi } from "vitest";
import { SubagentBatchPanel } from "./SubagentBatchPanel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@convex/_generated/api", () => ({
  api: { subagents: { queries: { getBatchView: "getBatchView" } } },
}));

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
}));

vi.mock("./MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));

describe("SubagentBatchPanel", () => {
  it("switches between subagent runs without submitting an enclosing form", () => {
    vi.mocked(useQuery).mockReturnValue({
      batch: {
        status: "completed",
        childCount: 2,
        completedChildCount: 2,
        failedChildCount: 0,
      },
      runs: [
        {
          _id: "run_1",
          childIndex: 1,
          title: "Research",
          taskPrompt: "Find sources",
          status: "completed",
          content: "Research content",
        },
        {
          _id: "run_2",
          childIndex: 2,
          title: "Summarize",
          taskPrompt: "Summarize sources",
          status: "completed",
          content: "Summary content",
        },
      ],
    });
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());

    render(
      <form onSubmit={onSubmit}>
        <SubagentBatchPanel messageId={"msg_1" as never} batchId={"batch_1" as never} />
      </form>,
    );

    expect(screen.getByText("Research content")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Summarize" }));

    expect(screen.getByText("Summary content")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
