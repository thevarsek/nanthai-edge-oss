import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { McpAuthorizePage } from "./McpAuthorizePage";

const { consent, authorize } = vi.hoisted(() => ({ consent: { value: { name: "QA AI client", isVerified: false, redirectHost: "127.0.0.1", redirectUri: "http://127.0.0.1/callback", scopes: ["history:read", "chat:write"] } as object | null }, authorize: vi.fn() }));
vi.mock("@clerk/react", () => ({ useUser: () => ({ user: { primaryEmailAddress: { emailAddress: "review@example.test" } } }) }));
vi.mock("convex/react", () => ({ useQuery: () => consent.value, useMutation: () => authorize }));
vi.mock("@convex/_generated/api", () => ({ api: { external_mcp: { oauth: { getConsent: "get", consent: "consent" } } } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
beforeEach(() => {
  consent.value = { name: "QA AI client", isVerified: false, redirectHost: "127.0.0.1", redirectUri: "http://127.0.0.1/callback", scopes: ["history:read", "chat:write"] };
  authorize.mockReset();
});
function page() { return render(<MemoryRouter initialEntries={["/mcp/authorize?request=qa"]}><McpAuthorizePage /></MemoryRouter>); }
it("keeps a submitted consent in progress when its single-use request is consumed", () => {
  authorize.mockReturnValue(new Promise(() => {}));
  const view = page();
  fireEvent.click(screen.getByRole("button", { name: "external_mcp_connect" }));
  consent.value = null;
  view.rerender(<MemoryRouter><McpAuthorizePage /></MemoryRouter>);
  expect(screen.getByRole("status")).toHaveTextContent("loading");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(authorize).toHaveBeenCalledTimes(1);
});
it("shows the account/client and sends only independently selected scopes after explicit consent", async () => {
  authorize.mockRejectedValue(new Error("Test response failed"));
  page();
  expect(screen.getByText("review@example.test")).toBeInTheDocument();
  expect(screen.getByText("QA AI client")).toBeInTheDocument();
  expect(authorize).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("external_mcp_scope_chat_write"));
  fireEvent.click(screen.getByRole("button", { name: "external_mcp_connect" }));
  await waitFor(() => expect(authorize).toHaveBeenCalledWith({ request: "qa", allow: true, scopes: ["history:read"] }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Test response failed");
});
it("an expired handshake offers no connect button", () => {
  consent.value = null;
  page();
  expect(screen.getByRole("alert")).toHaveTextContent("external_mcp_restart");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
it("identifies the destination prominently and labels impersonated app names as unverified", () => {
  consent.value = { name: "NanthAI for Mac", isVerified: false, redirectUri: "https://attacker.example/callback", redirectHost: "attacker.example", scopes: ["history:read"] };
  page();
  expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("attacker.example");
  expect(screen.queryByRole("heading", { name: "NanthAI for Mac" })).not.toBeInTheDocument();
  expect(screen.getByRole("note")).toHaveTextContent("external_mcp_unverified_app");
  expect(screen.getByRole("note")).toHaveTextContent("external_mcp_unverified_warning");
  expect(screen.getByText("NanthAI for Mac").parentElement).toHaveTextContent("external_mcp_self_reported_name");
  expect(authorize).not.toHaveBeenCalled();
});
it("leaves tool and paired-computer access unticked and requires tools before local execution", async () => {
  consent.value = { name: "QA AI client", isVerified: false, redirectHost: "127.0.0.1", redirectUri: "http://127.0.0.1/callback", scopes: ["chat:write", "chat:tools", "runtime:local"] };
  authorize.mockReturnValue(new Promise(() => {}));
  page();
  const tools = screen.getByLabelText("external_mcp_scope_chat_tools");
  const local = screen.getByLabelText("external_mcp_scope_runtime_local");
  expect(screen.getByLabelText("external_mcp_scope_chat_write")).toBeChecked();
  expect(tools).not.toBeChecked();
  expect(local).not.toBeChecked();
  expect(local).toBeDisabled();
  fireEvent.click(tools);
  expect(local).toBeEnabled();
  fireEvent.click(local);
  expect(local).toBeChecked();
  fireEvent.click(tools);
  expect(local).not.toBeChecked();
  expect(local).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "external_mcp_connect" }));
  await waitFor(() => expect(authorize).toHaveBeenCalledWith({ request: "qa", allow: true, scopes: ["chat:write"] }));
});
