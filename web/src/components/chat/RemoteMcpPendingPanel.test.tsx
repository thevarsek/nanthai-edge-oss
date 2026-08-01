import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { RemoteMcpPendingPanel } from "./RemoteMcpPendingPanel";

const respond = vi.hoisted(() => vi.fn(async () => null));

vi.mock("convex/react", () => ({
  useQuery: () => [{
    invocationId: "invocation-1",
    state: "awaiting_input",
    kind: "tool",
    serverName: "Fixture server",
    itemName: "Create issue",
    inputRequests: {
      confirmation: {
        params: {
          mode: "form",
          message: "Choose a project",
          requestedSchema: { type: "object", properties: { project: { type: "string" } } },
        },
      },
    },
  }],
  useAction: (endpoint: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(endpoint) === "mcp/continuation_actions:respondToInput"
      ? respond
      : vi.fn(async () => null),
}));

describe("RemoteMcpPendingPanel", () => {
  it("projects protocol-native pending input and sends the user's decision", async () => {
    respond.mockClear();
    render(<RemoteMcpPendingPanel chatId={"chat-1" as never} />);
    expect(screen.getByText("Create issue")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(respond).toHaveBeenCalledWith({
      invocationId: "invocation-1",
      inputResponses: { confirmation: { action: "decline" } },
    }));
  });
});
