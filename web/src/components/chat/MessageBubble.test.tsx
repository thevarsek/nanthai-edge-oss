import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { Message } from "@/hooks/useChat";
import { MessageBubble } from "./MessageBubble";

vi.mock("./MessageBubble.UserMessage", () => ({
  UserMessage: ({ message }: { message: Message }) => <div data-testid="user-message">{message.content}</div>,
}));

vi.mock("./MessageBubble.AssistantMessage", () => ({
  AssistantMessage: ({
    message,
    onRetry,
    onFork,
    onRetryWithDifferentModel,
  }: {
    message: Message;
    onRetry: () => void;
    onFork: () => void;
    onRetryWithDifferentModel?: () => void;
  }) => (
    <div data-testid="assistant-message">
      <span>{message.content}</span>
      <button type="button" onClick={onRetry}>retry</button>
      <button type="button" onClick={onFork}>fork</button>
      {onRetryWithDifferentModel && <button type="button" onClick={onRetryWithDifferentModel}>retry different</button>}
    </div>
  ),
}));

function message(role: Message["role"], content = "hello"): Message {
  return {
    _id: `${role}_message` as Id<"messages">,
    _creationTime: 1,
    chatId: "chat_1" as Id<"chats">,
    role,
    content,
    status: "completed",
    createdAt: 1,
  } as Message;
}

describe("MessageBubble", () => {
  it("delegates user messages to the user bubble", () => {
    render(
      <MessageBubble
        message={message("user", "User text")}
        isStreaming={false}
        participants={[]}
        onRetry={vi.fn()}
        onFork={vi.fn()}
      />,
    );

    expect(screen.getByTestId("user-message")).toHaveTextContent("User text");
  });

  it("scopes assistant retry, fork, and retry-with-different-model callbacks to the message id", () => {
    const onRetry = vi.fn();
    const onFork = vi.fn();
    const onRetryWithDifferentModel = vi.fn();

    render(
      <MessageBubble
        message={message("assistant", "Assistant text")}
        isStreaming={false}
        participants={[]}
        onRetry={onRetry}
        onFork={onFork}
        onRetryWithDifferentModel={onRetryWithDifferentModel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "retry" }));
    fireEvent.click(screen.getByRole("button", { name: "fork" }));
    fireEvent.click(screen.getByRole("button", { name: "retry different" }));

    expect(onRetry).toHaveBeenCalledWith("assistant_message");
    expect(onFork).toHaveBeenCalledWith("assistant_message");
    expect(onRetryWithDifferentModel).toHaveBeenCalledWith("assistant_message");
  });

  it("renders system messages inline and omits retry-different when no handler exists", () => {
    const { rerender } = render(
      <MessageBubble
        message={message("assistant")}
        isStreaming={false}
        participants={[]}
        onRetry={vi.fn()}
        onFork={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "retry different" })).not.toBeInTheDocument();

    rerender(
      <MessageBubble
        message={message("system", "System note")}
        isStreaming={false}
        participants={[]}
        onRetry={vi.fn()}
        onFork={vi.fn()}
      />,
    );

    expect(screen.getByText("System note")).toBeInTheDocument();
  });
});
