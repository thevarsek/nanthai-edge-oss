import { fireEvent, render, screen } from "@testing-library/react";
import { useQuery } from "convex/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RuntimeNativeAgentPanel } from "./RuntimeNativeAgentPanel";

vi.mock("@convex/_generated/api", () => ({
  api: { runtime_host: { native_agents: { getForMessage: "getForMessage" } } },
}));

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
}));

vi.mock("./MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content, streaming }: { content: string; streaming: boolean }) => (
    <div data-streaming={streaming}>{content}</div>
  ),
}));

const translations: Record<string, string> = {
  runtime_native_agent_origin: "Codex native agent",
  runtime_native_agent_waiting: "Waiting for agent activity…",
  runtime_native_agent_collapse: "Collapse Codex native agent details",
  runtime_native_agent_expand: "Expand Codex native agent details",
  runtime_native_agent_prompt: "Prompt",
  runtime_native_agent_activity: "Latest activity",
  runtime_native_agent_output: "Output",
  runtime_native_agent_interrupted: "Interrupted",
  runtime_native_agent_shutdown: "Stopped",
  runtime_native_agent_not_found: "Unavailable",
  runtime_native_agent_truncated: "More agents ran than this view can show.",
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { index?: number }) => {
      if (key === "runtime_native_agent_fallback") return `Agent ${values?.index}`;
      return translations[key] ?? key;
    },
  }),
}));

function activeView() {
  return {
    origin: "codex_native_agent",
    group: {
      id: "group_1",
      messageId: "message_1",
      status: "active",
      startedAt: 1,
      updatedAt: 2,
    },
    agents: [
      {
        id: "agent_1",
        nativeThreadId: "thread_1",
        depth: 1,
        nickname: "Scout",
        role: "Researcher",
        status: "running",
        prompt: "Review the routing code",
        latestActivityKind: "tool",
        latestActivity: "Reading routes.ts",
        output: "Found one active route",
        actualModel: { modelId: "gpt-5.6-luna", reportedByAdapter: true },
        startedAt: 1,
        updatedAt: 2,
      },
      {
        id: "agent_2",
        nativeThreadId: "thread_2",
        depth: 1,
        role: "Reviewer",
        status: "pending",
        startedAt: 1,
        updatedAt: 2,
      },
    ],
    agentsTruncated: true,
  };
}

describe("RuntimeNativeAgentPanel", () => {
  beforeEach(() => {
    vi.mocked(useQuery).mockReset();
  });

  it("reactively presents multiple backstage Codex agents without execution controls", () => {
    vi.mocked(useQuery).mockReturnValue(activeView());

    render(<RuntimeNativeAgentPanel messageId={"message_1" as never} />);

    expect(useQuery).toHaveBeenCalledWith("getForMessage", { messageId: "message_1" });
    expect(screen.getByText("Codex native agent")).toBeInTheDocument();
    expect(screen.getByText("Researcher · gpt-5.6-luna")).toBeInTheDocument();
    expect(screen.getByText("Review the routing code")).toBeInTheDocument();
    expect(screen.getByText("Reading routes.ts")).toBeInTheDocument();
    expect(screen.getByText("Found one active route")).toHaveAttribute("data-streaming", "true");
    expect(screen.getByText("More agents ran than this view can show.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reviewer" }));
    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /stop|cancel|steer/i })).not.toBeInTheDocument();
  });

  it("shows failed and interrupted children and supports collapsing the bounded detail", () => {
    vi.mocked(useQuery).mockReturnValue({
      ...activeView(),
      group: { ...activeView().group, status: "interrupted" },
      agents: [
        { ...activeView().agents[0], status: "failed", output: undefined, error: "Agent failed" },
        {
          ...activeView().agents[1],
          status: "interrupted",
          statusSummary: "Interrupted when the parent turn stopped",
        },
      ],
      agentsTruncated: false,
    });

    render(<RuntimeNativeAgentPanel messageId={"message_1" as never} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Agent failed");
    fireEvent.click(screen.getByRole("button", { name: "Reviewer" }));
    expect(screen.getByText("Interrupted")).toBeInTheDocument();
    expect(screen.getByText("Interrupted when the parent turn stopped")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse Codex native agent details" }));
    expect(screen.queryByText("Interrupted")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand Codex native agent details" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("shows a bounded waiting state while the linked projection loads", () => {
    vi.mocked(useQuery).mockReturnValue(undefined);

    render(<RuntimeNativeAgentPanel messageId={"message_1" as never} />);

    expect(screen.getByText("Waiting for agent activity…")).toBeInTheDocument();
  });

  it("renders nothing when the linked projection is unavailable", () => {
    vi.mocked(useQuery).mockReturnValue(null);

    const view = render(<RuntimeNativeAgentPanel messageId={"message_1" as never} />);

    expect(view.container).toBeEmptyDOMElement();
  });
});
