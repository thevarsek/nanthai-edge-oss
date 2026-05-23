import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { Message } from "@/hooks/useChat";
import { MultiModelResponseGroup } from "./MultiModelResponseGroup";

vi.mock("./MessageBubble", () => ({
  MessageBubble: ({ message, isStreaming }: { message: Message; isStreaming: boolean }) => (
    <div data-testid={`message-${message._id}`} data-streaming={String(isStreaming)}>
      {message.content}
    </div>
  ),
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
});
