import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { AdvisorBatchView } from "@/advisors/types";
import { AdvisorBatchPanel } from "@/components/chat/AdvisorBatchPanel";

const state = vi.hoisted(() => ({ batch: null as AdvisorBatchView | null }));
const cancelBatch = vi.hoisted(() => vi.fn());

vi.mock("@convex/_generated/api", () => ({
  api: { advisors: { queries: { getBatchView: "getBatchView" }, mutations: { cancelBatch: "cancelBatch" } } },
}));
vi.mock("convex/react", () => ({
  useQuery: () => state.batch,
  useMutation: () => cancelBatch,
}));
vi.mock("@/lib/analytics", () => ({ captureAnalytics: vi.fn() }));
vi.mock("@/components/chat/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));

function batch(status: AdvisorBatchView["status"] = "running"): AdvisorBatchView {
  return {
    _id: "batch_1" as Id<"advisorBatches">,
    chatId: "chat_1" as Id<"chats">,
    userMessageId: "message_user" as Id<"messages">,
    assistantMessageIds: ["message_assistant" as Id<"messages">],
    status,
    expectedRunCount: 1,
    completedRunCount: status === "completed" ? 1 : 0,
    failedRunCount: 0,
    createdAt: 1,
    updatedAt: 2,
    runs: [{
      _id: "run_1" as Id<"advisorRuns">,
      personaId: "persona_1" as Id<"personas">,
      personaSnapshot: { displayName: "Maya", avatarEmoji: "🔎" },
      instanceName: "Advisor 1",
      sortOrder: 0,
      status: status === "completed" ? "completed" : "streaming",
      stage: status,
      allowWebSearch: true,
      requestedModelId: "openai/gpt-4.1-mini",
      partialAdvice: status === "completed" ? undefined : "Streaming private note",
      advice: status === "completed" ? "Completed **advice**" : undefined,
      cost: 0.002,
      durationMs: 1200,
    }],
  };
}

describe("AdvisorBatchPanel", () => {
  beforeEach(() => {
    state.batch = batch();
    cancelBatch.mockReset();
  });

  it("stays collapsed by default, streams advice when expanded, and supports cancellation", async () => {
    render(<AdvisorBatchPanel batchId={"batch_1" as Id<"advisorBatches">} />);

    expect(screen.queryByText("Streaming private note")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand Advisor advice" }));
    expect(screen.getByText("Streaming private note")).toBeInTheDocument();
    const stopButton = screen.getByRole("button", { name: "Stop Advisors" });
    fireEvent.click(stopButton);
    expect(cancelBatch).toHaveBeenCalledWith({ batchId: "batch_1" });
    await waitFor(() => expect(stopButton).not.toBeDisabled());
  });

  it("renders completed Markdown and advanced stats", () => {
    state.batch = batch("completed");
    render(<AdvisorBatchPanel batchId={"batch_1" as Id<"advisorBatches">} showAdvancedStats />);
    fireEvent.click(screen.getByRole("button", { name: "Expand Advisor advice" }));

    expect(screen.getByText("Completed **advice**")).toBeInTheDocument();
    expect(screen.getByText("1.2s")).toBeInTheDocument();
    expect(screen.getByText("$0.0020")).toBeInTheDocument();
  });

  it("uses the graceful shared error parser for failed advice", () => {
    state.batch = batch("failed");
    state.batch.runs[0] = {
      ...state.batch.runs[0]!,
      status: "failed",
      partialAdvice: undefined,
      advice: undefined,
      errorMessage: '{"code":"UPSTREAM","message":"Advisor provider is temporarily unavailable"}',
    };
    render(<AdvisorBatchPanel batchId={"batch_1" as Id<"advisorBatches">} />);
    fireEvent.click(screen.getByRole("button", { name: "Expand Advisor advice" }));

    expect(screen.getByText("Advisor provider is temporarily unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/code.*UPSTREAM/)).not.toBeInTheDocument();
  });

  it.each([
    { batchStatus: "failed" as const, runStatus: "failed" as const, expected: "This Advisor consultation failed." },
    { batchStatus: "failed" as const, runStatus: "timedOut" as const, expected: "This Advisor consultation timed out." },
    { batchStatus: "cancelled" as const, runStatus: "cancelled" as const, expected: "This Advisor consultation was cancelled." },
  ])("keeps partial advice and shows the localized $runStatus status", ({ batchStatus, runStatus, expected }) => {
    state.batch = batch(batchStatus);
    state.batch.runs[0] = {
      ...state.batch.runs[0]!,
      status: runStatus,
      partialAdvice: "Useful partial guidance",
      advice: undefined,
      errorMessage: undefined,
    };
    render(<AdvisorBatchPanel batchId={"batch_1" as Id<"advisorBatches">} />);
    fireEvent.click(screen.getByRole("button", { name: "Expand Advisor advice" }));

    expect(screen.getByText("Useful partial guidance")).toBeInTheDocument();
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.queryByText("Waiting for private advice…")).not.toBeInTheDocument();
  });

  it("shows a localized retryable state when cancellation fails", async () => {
    cancelBatch.mockRejectedValueOnce(new Error("Server Error"));
    cancelBatch.mockResolvedValueOnce({ cancelled: true });
    render(<AdvisorBatchPanel batchId={"batch_1" as Id<"advisorBatches">} />);

    fireEvent.click(screen.getByRole("button", { name: "Stop Advisors" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t stop Advisors. Try again.");
    fireEvent.click(screen.getByRole("button", { name: "Retry stopping Advisors" }));
    await waitFor(() => expect(cancelBatch).toHaveBeenCalledTimes(2));
  });

  it("hides Stop during final synthesis", () => {
    state.batch = batch("synthesizing");
    render(<AdvisorBatchPanel batchId={"batch_1" as Id<"advisorBatches">} />);

    expect(screen.getByText("Synthesizing response")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop Advisors" })).not.toBeInTheDocument();
  });

});
