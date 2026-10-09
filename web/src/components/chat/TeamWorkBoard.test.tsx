import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import type { Id } from "@convex/_generated/dataModel";
import { TeamWorkBoard } from "./TeamWorkBoard";

const state = vi.hoisted(() => ({ mutate: vi.fn<(name: string, args: unknown) => Promise<unknown>>(async () => null), query: vi.fn() }));
const board = {
  canResume: true,
  settings: { durationMinutes: 15, maxWaves: 5, maxPublicReplies: 8, consensusAutoStop: false },
  work: [{ _id: "work", objective: "Write proposal", status: "review", revision: 3, requirementRevision: 1,
    evidenceRevision: 1, sourceRevision: "draft-1", assigneeId: "writer", reviewerIds: ["reviewer"],
    dependencyIds: [], acceptanceCriteria: ["Includes costs"], dependenciesReady: true,
    needsRevalidation: false, evidence: [{ messageId: "reply", description: "Proposal", sourceRevision: "draft-1" }] }],
  participants: [{ id: "writer", name: "Writer" }, { id: "reviewer", name: "Reviewer" }],
};
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(ref); state.query(name, args);
    return name === "chat/queries:getMessage" ? { content: "Exact committed proposal" } : board;
  },
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) => state.mutate(getFunctionName(ref), args),
}));

describe("Collaboration goals", () => {
  it("does not offer resume for cancelled goals or hard-coded presets", () => {
    board.canResume = false;
    render(<TeamWorkBoard chatId={"chat" as Id<"chats">} embedded />);
    expect(screen.queryByRole("button", { name: "Resume remaining goals" })).not.toBeInTheDocument();
    expect(screen.queryByText("Extended work preset")).not.toBeInTheDocument();
    expect(screen.queryByText("Owner/reviewer example")).not.toBeInTheDocument();
    board.canResume = true;
  });
  it("loads on demand and sends explicit acceptance against exact revisions", async () => {
    state.query.mockClear(); state.mutate.mockClear();
    render(<TeamWorkBoard chatId={"chat" as Id<"chats">} />);
    expect(state.query).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Goals and limits" }));
    expect(screen.getByText("Write proposal")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept evidence" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Review evidence / override reason"), { target: { value: "Verified costs and requirements" } });
    fireEvent.click(screen.getByRole("button", { name: "Accept evidence" }));
    await waitFor(() => expect(state.mutate).toHaveBeenCalledWith("collaboration/work_reviews:reviewWork", {
      workId: "work", revision: 3, requirementRevision: 1, evidenceRevision: 1,
      sourceRevision: "draft-1", outcome: "accept", reason: "Verified costs and requirements",
    }));
  });

  it("saves an assigned objective and preserves the approved extended limits", async () => {
    state.mutate.mockClear();
    render(<TeamWorkBoard chatId={"chat" as Id<"chats">} />);
    fireEvent.click(screen.getByRole("button", { name: "Goals and limits" }));
    fireEvent.click(screen.getByRole("button", { name: "Add goal" }));
    fireEvent.change(screen.getByLabelText("Objective"), { target: { value: "Research options" } });
    fireEvent.click(screen.getByRole("button", { name: "Assigned to" }));
    fireEvent.click(screen.getByRole("button", { name: "Writer" }));
    fireEvent.change(screen.getByLabelText("Success criteria (optional)"), { target: { value: "Cite sources\nCompare costs" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and start" }));
    await waitFor(() => expect(state.mutate).toHaveBeenCalledWith("collaboration/work_mutations:createWork", {
      chatId: "chat", objective: "Research options", start: true, acceptanceCriteria: ["Cite sources\nCompare costs"],
      assigneeId: "writer", reviewerIds: [], dependencyIds: [], readOnlyReview: false,
    }));
    fireEvent.change(screen.getByLabelText("Time limit (minutes)"), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText("Rounds"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("AI replies"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Save limits" }));
    await waitFor(() => expect(state.mutate).toHaveBeenCalledWith("collaboration/work_mutations:setSettings", {
      chatId: "chat", settings: { durationMinutes: 60, maxWaves: 50, maxPublicReplies: 50, consensusAutoStop: false },
    }));
  });
  it("opens automatically published evidence without offering manual attachment", () => {
    state.query.mockClear(); state.mutate.mockClear();
    render(<TeamWorkBoard chatId={"chat" as Id<"chats">} />);
    fireEvent.click(screen.getByRole("button", { name: "Goals and limits" }));
    fireEvent.click(screen.getByRole("button", { name: "View result" }));
    expect(screen.getByRole("dialog", { name: "Published evidence" })).toHaveTextContent("Exact committed proposal");
    expect(state.query).toHaveBeenCalledWith("chat/queries:getMessage", { messageId: "reply" });
    fireEvent.click(screen.getByRole("button", { name: "Close evidence" }));
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    expect(screen.queryByRole("button", { name: "Attach evidence" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Completed reply")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit / reassign" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry goal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel goal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept evidence" })).toBeInTheDocument();
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("keeps review notes bound to their original result when live evidence changes", async () => {
    const original = board.work[0];
    state.mutate.mockClear();
    try {
      const { rerender } = render(<TeamWorkBoard chatId={"chat" as Id<"chats">} embedded />);
      fireEvent.change(screen.getByLabelText("Review evidence / override reason"), { target: { value: "Verified original result" } });
      fireEvent.click(screen.getByRole("button", { name: "View result" }));
      expect(screen.getByRole("dialog")).toHaveTextContent("Exact committed proposal");
      board.work[0] = { ...original, revision: 4, evidenceRevision: 2, sourceRevision: "draft-2",
        evidence: [{ messageId: "reply-2", description: "Replaced proposal", sourceRevision: "draft-2" }] };
      rerender(<TeamWorkBoard chatId={"chat" as Id<"chats">} embedded />);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByLabelText("Review evidence / override reason")).toHaveValue("Verified original result");
      fireEvent.click(screen.getByRole("button", { name: "Accept evidence" }));
      await waitFor(() => expect(state.mutate).toHaveBeenLastCalledWith("collaboration/work_reviews:reviewWork", {
        workId: "work", revision: 3, requirementRevision: 1, evidenceRevision: 1, sourceRevision: "draft-1",
        outcome: "accept", reason: "Verified original result",
      }));
      fireEvent.change(screen.getByLabelText("Review evidence / override reason"), { target: { value: "" } });
      fireEvent.change(screen.getByLabelText("Review evidence / override reason"), { target: { value: "Verified replacement" } });
      fireEvent.click(screen.getByRole("button", { name: "View result" }));
      expect(state.query).toHaveBeenLastCalledWith("chat/queries:getMessage", { messageId: "reply-2" });
      fireEvent.click(screen.getByRole("button", { name: "Close evidence" }));
      fireEvent.click(screen.getByRole("button", { name: "Accept evidence" }));
      await waitFor(() => expect(state.mutate).toHaveBeenLastCalledWith("collaboration/work_reviews:reviewWork", {
        workId: "work", revision: 4, requirementRevision: 1, evidenceRevision: 2, sourceRevision: "draft-2",
        outcome: "accept", reason: "Verified replacement",
      }));
    } finally { board.work[0] = original; }
  });

});
