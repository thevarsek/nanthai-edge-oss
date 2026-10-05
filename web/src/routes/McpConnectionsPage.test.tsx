import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { McpConnectionsPage } from "./McpConnectionsPage";

const { revoke } = vi.hoisted(() => ({ revoke: vi.fn() }));
vi.mock("convex/react", () => ({ useQuery: () => [{ id: "grant", name: "QA client", scopes: ["runs:stop"], createdAt: 123.0 }], useMutation: () => revoke }));
vi.mock("@convex/_generated/api", () => ({ api: { external_mcp: { oauth: { listMyConnections: "list", revoke: "revoke" } } } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
it("renders connection scopes and preserves a failed revoke for retry", async () => {
  revoke.mockRejectedValue(new Error("Revocation failed"));
  render(<MemoryRouter><McpConnectionsPage /></MemoryRouter>);
  expect(screen.getByText("QA client")).toBeInTheDocument();
  expect(screen.getByText("external_mcp_scope_runs_stop")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "external_mcp_revoke" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Revocation failed");
  expect(revoke).toHaveBeenCalledWith({ grantId: "grant" });
  expect(screen.getByRole("button", { name: "external_mcp_revoke" })).toBeEnabled();
});
