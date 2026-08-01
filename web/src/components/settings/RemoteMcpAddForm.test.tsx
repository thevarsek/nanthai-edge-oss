import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RemoteMcpAddForm } from "./RemoteMcpAddForm";

describe("RemoteMcpAddForm", () => {
  it("submits a bearer credential without rendering it back", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<RemoteMcpAddForm isSaving={false} onCancel={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("Server URL"), { target: { value: "https://mcp.example.com/mcp" } });
    fireEvent.change(screen.getByLabelText("Authentication"), { target: { value: "bearer" } });
    fireEvent.change(screen.getByLabelText(/^Credential/), { target: { value: "secret-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Validate server" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      endpoint: "https://mcp.example.com/mcp",
      friendlyName: undefined,
      authMode: "bearer",
      secret: "secret-token",
      apiKeyHeader: undefined,
    }));
    expect(screen.getByLabelText(/^Credential/)).toHaveAttribute("type", "password");
  });

  it("collects a safe custom API key header separately from the value", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<RemoteMcpAddForm isSaving={false} onCancel={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Server URL"), { target: { value: "https://mcp.example.com" } });
    fireEvent.change(screen.getByLabelText("Authentication"), { target: { value: "api_key" } });
    fireEvent.change(screen.getByLabelText("API key header"), { target: { value: "x-service-key" } });
    fireEvent.change(screen.getByLabelText(/^Credential/), { target: { value: "key-value" } });
    fireEvent.click(screen.getByRole("button", { name: "Validate server" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      authMode: "api_key",
      apiKeyHeader: "x-service-key",
      secret: "key-value",
    })));
  });

  it("does not submit a stale credential after switching to a secretless auth mode", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<RemoteMcpAddForm isSaving={false} onCancel={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Server URL"), { target: { value: "https://mcp.example.com" } });
    fireEvent.change(screen.getByLabelText("Authentication"), { target: { value: "bearer" } });
    fireEvent.change(screen.getByLabelText(/^Credential/), { target: { value: "stale-secret" } });
    fireEvent.change(screen.getByLabelText("Authentication"), { target: { value: "oauth" } });
    fireEvent.click(screen.getByRole("button", { name: "Validate server" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      authMode: "oauth",
      secret: undefined,
    })));
  });
});
