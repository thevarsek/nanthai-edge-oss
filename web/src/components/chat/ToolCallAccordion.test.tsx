import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolCallAccordion } from "./ToolCallAccordion";

vi.mock("./ToolResultRenderers.router", () => ({
  renderToolResult: vi.fn(() => null),
}));

describe("ToolCallAccordion", () => {
  it("renders nothing without tool calls or trace metadata", () => {
    const { container } = render(<ToolCallAccordion toolCalls={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows pending, completed, and error tool states when expanded", () => {
    render(
      <ToolCallAccordion
        isStreaming
        toolCalls={[
          { id: "call_1", name: "web_search", arguments: "{\"query\":\"test\"}" },
          { id: "call_2", name: "workspace_exec", arguments: "not-json" },
          { id: "call_3", name: "load_skill", arguments: "{\"skillName\":\"Docs\"}" },
        ] as never}
        toolResults={[
          { toolCallId: "call_2", result: "{\"ok\":true}", isError: false },
          { toolCallId: "call_3", result: "failed", isError: true },
        ] as never}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /using/i }));

    expect(screen.getByText("Web Search")).toBeInTheDocument();
    expect(screen.getByText("Run Code")).toBeInTheDocument();
    expect(screen.getByText("Load Skill")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("renders trace metadata without tool calls", () => {
    render(<ToolCallAccordion toolCalls={[]} loadedSkillIds={["skill_a"]} usedIntegrationIds={["drive"]} />);

    fireEvent.click(screen.getByRole("button", { name: /orchestration/i }));

    expect(screen.getByText("skill_a")).toBeInTheDocument();
    expect(screen.getByText("drive")).toBeInTheDocument();
  });
});
