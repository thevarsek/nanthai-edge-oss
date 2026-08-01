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
        activeToolCallIds={["call_1"]}
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

  it("shows cumulative continuation tools with only the current call running", () => {
    render(
      <ToolCallAccordion
        isStreaming
        activeToolCallIds={["call_2"]}
        toolCalls={[
          { id: "call_1", name: "load_skill", arguments: "{}" },
          { id: "call_2", name: "web_search", arguments: "{}" },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /using 2 tools/i }));

    expect(screen.getByText("Load Skill")).toBeInTheDocument();
    expect(screen.getByText("Web Search")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("(1/2)")).toBeInTheDocument();
  });

  it("shows friendly Remote MCP server and tool names", () => {
    render(
      <ToolCallAccordion
        toolCalls={[{
          id: "call_mcp",
          name: "mcp_c7f4b61d4d_search_cloudflare_documentation",
          arguments: "{}",
          source: "remote_mcp",
          displayName: "Search Cloudflare documentation",
          integrationId: "mcp:connection-1",
          integrationName: "Cloudflare Docs",
        }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /used 1 tool/i }));

    expect(screen.getByText("Search Cloudflare documentation")).toBeInTheDocument();
    expect(screen.getByText("Cloudflare Docs · Remote MCP")).toBeInTheDocument();
    expect(screen.queryByText(/mcp_c7f4b61d4d/)).not.toBeInTheDocument();
  });

  it("renders trace metadata without tool calls", () => {
    render(<ToolCallAccordion toolCalls={[]} loadedSkillIds={["skill_a"]} usedIntegrationIds={["drive"]} />);

    fireEvent.click(screen.getByRole("button", { name: /orchestration/i }));

    expect(screen.getByText("skill_a")).toBeInTheDocument();
    expect(screen.getByText("drive")).toBeInTheDocument();
  });

  it("keeps sanitized technical payloads behind a second details disclosure", () => {
    const internalId = "kg22hgqr3n05ys9zvyjkbx08858anmgb";
    render(
      <ToolCallAccordion
        toolCalls={[{
          id: "call_1",
          name: "create_presentation",
          arguments: JSON.stringify({
            brief: "Quarterly plan",
            storageId: internalId,
            assetStorageIds: ["asset_private"],
          }),
        }] as never}
        toolResults={[{
          toolCallId: "call_1",
          result: JSON.stringify({
            storageId: internalId,
            downloadUrl: `https://files.convex.site/download?storageId=${internalId}`,
            presentationProjectId: "project_private",
            slideId: "slide_01",
          }),
          isError: false,
        }] as never}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /used 1 tool/i }));
    fireEvent.click(screen.getByRole("button", { name: /create presentation/i }));
    expect(screen.getByText("Completed successfully.")).toBeInTheDocument();
    expect(screen.queryByText("Quarterly plan")).not.toBeInTheDocument();
    expect(screen.queryByText(internalId)).not.toBeInTheDocument();
    expect(screen.queryByText(/asset_private/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Details: Create Presentation" }));
    expect(screen.getByText(/Quarterly plan/)).toBeInTheDocument();
    expect(screen.getAllByText(/\[internal\]/).length).toBeGreaterThan(0);
    expect(screen.getByText(/\[internal file URL\]/)).toBeInTheDocument();
    expect(screen.queryByText(internalId)).not.toBeInTheDocument();
    expect(screen.getByText(/slide_01/)).toBeInTheDocument();
  });

  it("renders technical errors with readable light and dark theme contrast", () => {
    render(
      <ToolCallAccordion
        toolCalls={[{
          id: "call_1",
          name: "create_presentation",
          arguments: "{}",
        }] as never}
        toolResults={[{
          toolCallId: "call_1",
          result: JSON.stringify({
            error: "Absolute text 's05-title' wraps outside its containing region.",
          }),
          isError: true,
        }] as never}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /used 1 tool/i }));
    fireEvent.click(screen.getByRole("button", { name: /create presentation/i }));
    fireEvent.click(screen.getByRole("button", { name: "Details: Create Presentation" }));

    const errorPayload = screen.getByText(/Absolute text 's05-title'/).closest("pre");
    expect(errorPayload).toHaveClass(
      "border-red-500/30",
      "bg-red-500/10",
      "text-red-800",
      "dark:text-red-200",
    );
  });
});
