import { describe, expect, it } from "vitest";
import {
  enabledRemoteMcpConnectionIds,
  filterRemoteMcpContentForEnabledConnections,
  stagedRemoteMcpContextsForChat,
  type RemoteMcpConnectionOption,
} from "./remoteMcp";

const connections: RemoteMcpConnectionOption[] = [
  {
    connectionId: "connection-1",
    integrationId: "mcp:first",
    displayName: "First server",
    endpointHost: "first.example.com",
    allowedItemCount: 2,
  },
  {
    connectionId: "connection-2",
    integrationId: "mcp:second",
    displayName: "Second server",
    endpointHost: "second.example.com",
    allowedItemCount: 1,
  },
];

describe("Remote MCP chat context filtering", () => {
  it("maps the chat's effective integration state to enabled connection IDs", () => {
    expect(enabledRemoteMcpConnectionIds(connections, new Set(["mcp:second"])))
      .toEqual(["connection-2"]);
  });

  it("keeps only context published by enabled connections", () => {
    const items = [
      { connectionId: "connection-1", stableKey: "prompt:first" },
      { connectionId: "connection-2", stableKey: "prompt:second" },
    ];

    expect(filterRemoteMcpContentForEnabledConnections(items, ["connection-2"]))
      .toEqual([{ connectionId: "connection-2", stableKey: "prompt:second" }]);
  });

  it("never carries staged context across chat navigation", () => {
    const contexts = [
      { chatId: "chat-1", connectionId: "connection-1", invocationId: "invocation-1" },
      { chatId: "chat-2", connectionId: "connection-1", invocationId: "invocation-2" },
    ];

    expect(stagedRemoteMcpContextsForChat(contexts, "chat-2", new Set(["connection-1"])))
      .toEqual([contexts[1]]);
  });
});
