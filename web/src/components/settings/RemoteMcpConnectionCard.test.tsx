import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RemoteMcpConnectionCard } from "./RemoteMcpConnectionCard";

const mockState = vi.hoisted(() => ({
  setFriendlyName: vi.fn(async () => null),
}));

vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useMutation: (endpoint: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(endpoint) === "mcp/mutations:setConnectionFriendlyName"
      ? mockState.setFriendlyName
      : vi.fn(async () => null),
  useAction: () => vi.fn(async () => null),
}));

beforeEach(() => {
  mockState.setFriendlyName.mockReset();
  mockState.setFriendlyName.mockResolvedValue(null);
});

describe("RemoteMcpConnectionCard", () => {
  it("lets the user override and clear the server display name", async () => {
    const connection = {
      id: "connection-1",
      displayName: "Cloudflare MCP Server",
      endpoint: "https://docs.example.com/mcp",
      endpointHost: "docs.example.com",
      serverName: "Cloudflare MCP Server",
      status: "reviewing",
      authMode: "none",
      protocolVersion: "2026-07-28",
      itemCount: 2,
      allowedItemCount: 1,
    };
    const { rerender } = render(<RemoteMcpConnectionCard connection={connection} />);

    const input = screen.getByRole("textbox", { name: "Server name" });
    fireEvent.change(input, { target: { value: "My documentation" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() => expect(mockState.setFriendlyName).toHaveBeenCalledWith({
      connectionId: "connection-1",
      friendlyName: "My documentation",
    }));

    rerender(<RemoteMcpConnectionCard connection={{
      ...connection,
      friendlyName: "My documentation",
      displayName: "My documentation",
    }} />);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() => expect(mockState.setFriendlyName).toHaveBeenLastCalledWith({
      connectionId: "connection-1",
    }));
  });
});
