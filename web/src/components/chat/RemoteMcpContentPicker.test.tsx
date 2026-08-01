import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { Id } from "@convex/_generated/dataModel";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  argumentLooksSecret,
  argumentNames,
  resolvedUri,
} from "./remoteMcpContentPickerUtils";
import { RemoteMcpContentPicker } from "./RemoteMcpContentPicker";

const state = vi.hoisted(() => ({
  invocationId: undefined as string | undefined,
  invoke: vi.fn(async (args: unknown) => {
    void args;
    return { invocationId: "invocation-1", state: "completed" };
  }),
}));

vi.mock("convex/react", () => ({
  useQuery: (endpoint: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(endpoint);
    if (name === "mcp/queries:listAvailableContent") return [{
      connectionId: "connection-1",
      stableKey: "prompt:research",
      serverName: "Fixture server",
      kind: "prompt",
      displayName: "Research prompt",
      arguments: [{ name: "topic", required: true, description: "Topic to research" }],
    }];
    if (name === "mcp/queries:getInvocation" && args !== "skip") {
      return state.invocationId ? { id: state.invocationId, state: "completed", kind: "prompt" } : undefined;
    }
    return undefined;
  },
  useAction: (endpoint: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(endpoint) === "mcp/actions:invoke"
      ? async (args: unknown) => {
          const result = await state.invoke(args);
          state.invocationId = result.invocationId;
          return result;
        }
      : vi.fn(async () => null),
}));

beforeEach(() => {
  state.invocationId = undefined;
  state.invoke.mockClear();
});

describe("RemoteMcpContentPicker", () => {
  it("blocks credential-like prompt arguments", () => {
    expect(argumentLooksSecret({ name: "verification", label: "API key", required: false })).toBe(true);
    expect(argumentLooksSecret({ name: "api_key", label: "Verification", required: false })).toBe(true);
    expect(argumentLooksSecret({ name: "apiKey", label: "Verification", required: false })).toBe(true);
    expect(argumentLooksSecret({
      name: "verification",
      label: "Verification",
      required: false,
      description: "Paste your private key",
    })).toBe(true);
    expect(argumentLooksSecret({ name: "topic", label: "Topic", required: true })).toBe(false);
  });

  it("expands RFC 6570 resource templates with the MCP SDK", () => {
    const item = {
      connectionId: "connection-1",
      stableKey: "resource-template:search",
      serverName: "Fixture server",
      kind: "resource_template" as const,
      displayName: "Search",
      uriTemplate: "https://mcp.example.com/search{?q,limit}",
    };

    expect(argumentNames(item).map((field) => field.name)).toEqual(["q", "limit"]);
    expect(resolvedUri(item, { q: "cats and dogs", limit: "5" }))
      .toBe("https://mcp.example.com/search?q=cats%20and%20dogs&limit=5");
    expect(argumentNames({ ...item, uriTemplate: "https://mcp.example.com/{" })).toEqual([]);
    expect(resolvedUri({ ...item, uriTemplate: "https://mcp.example.com/{" }, { q: "cats" }))
      .toBeUndefined();
  });

  it("invokes an attributed prompt and stages its completed invocation", async () => {
    const onAttach = vi.fn();
    render(<RemoteMcpContentPicker chatId={"chat-1" as Id<"chats">} enabledConnectionIds={["connection-1"]} onAttach={onAttach} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Research prompt/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /topic/i }), { target: { value: "MCP Tasks" } });
    fireEvent.click(screen.getByRole("button", { name: "Run prompt" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Attach to message/i })).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: /Attach to message/i }));
    expect(state.invoke).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "connection-1",
      stableKey: "prompt:research",
      arguments: { topic: "MCP Tasks" },
    }));
    expect(onAttach).toHaveBeenCalledWith({
      chatId: "chat-1",
      invocationId: "invocation-1",
      connectionId: "connection-1",
      label: "Research prompt",
      serverName: "Fixture server",
      kind: "prompt",
    });
  });

  it("hides context from Remote MCP servers that are not enabled for the chat", () => {
    render(<RemoteMcpContentPicker chatId={"chat-1" as Id<"chats">} enabledConnectionIds={[]} onAttach={vi.fn()} onClose={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /Research prompt/i })).not.toBeInTheDocument();
    expect(screen.getByText("Enable a Remote MCP server for this chat, then allow a prompt or resource in its catalog.")).toBeInTheDocument();
  });
});
