import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { Message } from "@/hooks/useChat";
import { MultiModelResponseGroup } from "./MultiModelResponseGroup";

vi.mock("./MessageBubble", () => ({
  MessageBubble: ({ message, isStreaming, suppressAdvisorPanel, executionRoute }: { message: Message; isStreaming: boolean; suppressAdvisorPanel?: boolean; executionRoute?: Message["executionRoute"] }) => (
    <div data-testid={`message-${message._id}`} data-route={executionRoute?.placement ?? "unknown"} data-streaming={String(isStreaming)} data-advisor-suppressed={String(suppressAdvisorPanel)}>
      {message.content}
    </div>
  ),
}));

vi.mock("./AdvisorBatchPanel", () => ({
  AdvisorBatchPanel: ({ batchId }: { batchId: string }) => <div data-testid="advisor-panel">{batchId}</div>,
}));

function message(id: string, status: Message["status"], content: string): Message {
  return {
    _id: id as Id<"messages">,
    _creationTime: 1,
    chatId: "chats_1" as Id<"chats">,
    role: "assistant",
    content,
    status,
    createdAt: 1,
  };
}

describe("MultiModelResponseGroup", () => {
  test("renders response count, per-message streaming state, and advanced total", () => {
    render(
      <MultiModelResponseGroup
        groupId="group_1"
        messages={[
          message("messages_1", "streaming", "First answer"),
          message("messages_2", "completed", "Second answer"),
        ]}
        isStreaming
        participants={[]}
        onRetry={vi.fn()}
        onFork={vi.fn()}
        messageCosts={{ messages_1: 0.01, messages_2: 0.02 }}
        showAdvancedStats
      />,
    );

    expect(screen.getByText("2 responses")).toBeInTheDocument();
    expect(screen.getByTestId("message-messages_1")).toHaveAttribute("data-streaming", "true");
    expect(screen.getByTestId("message-messages_2")).toHaveAttribute("data-streaming", "false");
    expect(screen.getByText(/Total:/)).toHaveTextContent("$0.0300");
  });

  test("keeps mixed responses tied to their own recorded routes", () => {
    render(<MultiModelResponseGroup groupId="mixed" messages={[
      { ...message("local", "completed", "Local answer"), executionRoute: { placement: "local", runtimeLabel: "Mac · codex" } },
      { ...message("cloud", "completed", "Cloud answer"), executionRoute: { placement: "cloud" } },
      message("legacy", "completed", "Unknown route"),
    ]} isStreaming={false} participants={[]} onRetry={vi.fn()} onFork={vi.fn()} />);
    expect(screen.getByTestId("message-local")).toHaveAttribute("data-route", "local");
    expect(screen.getByTestId("message-cloud")).toHaveAttribute("data-route", "cloud");
    expect(screen.getByTestId("message-legacy")).toHaveAttribute("data-route", "unknown");
  });

  test("renders one shared Advisor panel for a multi-model response group", () => {
    const first = { ...message("messages_1", "completed", "First"), advisorBatchId: "advisor_batch_1" as Id<"advisorBatches"> };
    const second = { ...message("messages_2", "completed", "Second"), advisorBatchId: "advisor_batch_1" as Id<"advisorBatches"> };
    render(
      <MultiModelResponseGroup
        groupId="group_1"
        messages={[first, second]}
        isStreaming={false}
        participants={[]}
        onRetry={vi.fn()}
        onFork={vi.fn()}
      />,
    );

    expect(screen.getAllByTestId("advisor-panel")).toHaveLength(1);
    expect(screen.getByTestId("advisor-panel")).toHaveTextContent("advisor_batch_1");
    expect(screen.getByTestId("message-messages_1")).toHaveAttribute("data-advisor-suppressed", "true");
    expect(screen.getByTestId("message-messages_2")).toHaveAttribute("data-advisor-suppressed", "true");
  });
});
