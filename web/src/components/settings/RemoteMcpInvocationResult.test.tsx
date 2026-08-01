import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RemoteMcpInvocationResult } from "./RemoteMcpInvocationResult";

describe("RemoteMcpInvocationResult", () => {
  it("renders a protocol-native form and returns keyed input responses", async () => {
    const onResume = vi.fn().mockResolvedValue(undefined);
    render(
      <RemoteMcpInvocationResult
        busy={false}
        value={{
          state: "awaiting_input",
          requestState: "opaque-state",
          inputRequests: {
            confirmation: {
              method: "elicitation/create",
              params: {
                mode: "form",
                message: "Confirm the action",
                requestedSchema: {
                  properties: { confirm: { type: "boolean", title: "Confirm" } },
                },
              },
            },
          },
        }}
        onResume={onResume}
        onTask={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Confirm"));
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(onResume).toHaveBeenCalledWith({
      confirmation: { action: "accept", content: { confirm: true } },
    }, "opaque-state"));
  });

  it("does not turn non-HTTPS URL elicitation into a link", () => {
    render(
      <RemoteMcpInvocationResult
        busy={false}
        value={{
          state: "awaiting_input",
          inputRequests: {
            open: { method: "elicitation/create", params: { mode: "url", url: "javascript:alert(1)" } },
          },
        }}
        onResume={vi.fn()}
        onTask={vi.fn()}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("blocks acceptance when a remote form asks for credential-like input", () => {
    render(
      <RemoteMcpInvocationResult
        busy={false}
        value={{
          state: "awaiting_input",
          inputRequests: {
            secret: {
              method: "elicitation/create",
              params: {
                mode: "form",
                requestedSchema: {
                  properties: { apiKey: { type: "string", title: "API key" } },
                },
              },
            },
          },
        }}
        onResume={vi.fn()}
        onTask={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
    expect(screen.getByText(/will not submit this form/i)).toBeInTheDocument();
  });

  it("returns numeric elicitation fields as numbers", async () => {
    const onResume = vi.fn().mockResolvedValue(undefined);
    render(
      <RemoteMcpInvocationResult
        busy={false}
        value={{
          state: "awaiting_input",
          inputRequests: {
            count: {
              method: "elicitation/create",
              params: {
                mode: "form",
                requestedSchema: { properties: { quantity: { type: "integer", title: "Quantity" } } },
              },
            },
          },
        }}
        onResume={onResume}
        onTask={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(onResume).toHaveBeenCalledWith({
      count: { action: "accept", content: { quantity: 3 } },
    }, undefined));
  });

  it("resumes ordinary input_required results instead of treating them as Tasks", async () => {
    const onResume = vi.fn().mockResolvedValue(undefined);
    const onTask = vi.fn().mockResolvedValue(undefined);
    render(
      <RemoteMcpInvocationResult
        busy={false}
        value={{
          state: "awaiting_input",
          result: { status: "input_required" },
          inputRequests: {
            confirmation: {
              method: "elicitation/create",
              params: { mode: "form", requestedSchema: { properties: {} } },
            },
          },
        }}
        onResume={onResume}
        onTask={onTask}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(onResume).toHaveBeenCalledOnce());
    expect(onTask).not.toHaveBeenCalled();
  });

  it("offers task polling and cooperative cancellation", () => {
    const onTask = vi.fn().mockResolvedValue(undefined);
    render(
      <RemoteMcpInvocationResult
        busy={false}
        value={{ invocationId: "inv-1", state: "task_pending", result: { status: "working" } }}
        onResume={vi.fn()}
        onTask={onTask}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Poll" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onTask).toHaveBeenNthCalledWith(1, "inv-1", "get");
    expect(onTask).toHaveBeenNthCalledWith(2, "inv-1", "cancel");
  });

  it("renders normalized prompt content without exposing the invocation record by default", () => {
    const prompt = `<system_context>${"Workers guidance ".repeat(100)}</system_context>`;
    render(
      <RemoteMcpInvocationResult
        busy={false}
        value={{
          invocationId: "inv-secret-looking-internal-id",
          state: "completed",
          contentItems: [{ kind: "text", role: "user", text: prompt }],
          result: { messages: [{ role: "user", content: { type: "text", text: prompt } }] },
        }}
        onResume={vi.fn()}
        onTask={vi.fn()}
      />,
    );

    expect(screen.getByRole("region", { name: "Remote MCP result" })).toBeVisible();
    expect(screen.getByText(/1 content block/)).toHaveTextContent(/characters · ≈[\d,]+ tokens/);
    expect(screen.getByText("Role: user")).toBeVisible();
    expect(screen.getByRole("button", { name: "Show full text" })).toBeVisible();
    expect(screen.queryByText(/inv-secret-looking-internal-id/)).not.toBeInTheDocument();
    expect(screen.queryByText(/"contentItems"/)).not.toBeInTheDocument();
  });

  it("keeps the original MCP response behind an explicit disclosure", () => {
    render(
      <RemoteMcpInvocationResult
        busy={false}
        value={{ state: "completed", result: { structuredContent: { answer: 42 } } }}
        onResume={vi.fn()}
        onTask={vi.fn()}
      />,
    );

    expect(screen.getByText("No previewable content was returned.")).toBeVisible();
    expect(screen.queryByText(/"answer": 42/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View raw MCP response" }));
    expect(screen.getByText(/"answer": 42/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Hide raw MCP response" })).toBeVisible();
  });

  it("renders safe links and leaves non-HTTPS resource identifiers as text", () => {
    render(
      <RemoteMcpInvocationResult
        busy={false}
        value={{
          state: "completed",
          contentItems: [
            { kind: "resource_link", name: "Guide", uri: "https://example.com/guide" },
            { kind: "resource_link", name: "Internal resource", uri: "mcp://docs/private" },
          ],
        }}
        onResume={vi.fn()}
        onTask={vi.fn()}
      />,
    );

    expect(screen.getByRole("link", { name: "https://example.com/guide" })).toHaveAttribute("href", "https://example.com/guide");
    expect(screen.getByText("mcp://docs/private")).toBeVisible();
  });
});
