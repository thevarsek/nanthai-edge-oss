import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { McpAuthorizePage } from "./McpAuthorizePage";

const { consent, authorize } = vi.hoisted(() => ({ consent: { value: { name: "QA AI client", redirectUri: "http://127.0.0.1/callback", scopes: ["history:read", "chat:write"] } as object | null }, authorize: vi.fn() }));
vi.mock("@clerk/react", () => ({ useUser: () => ({ user: { primaryEmailAddress: { emailAddress: "review@example.test" } } }) }));
vi.mock("convex/react", () => ({ useQuery: () => consent.value, useMutation: () => authorize }));
vi.mock("@convex/_generated/api", () => ({ api: { external_mcp: { oauth: { getConsent: "get", consent: "consent" } } } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
beforeEach(() => {
  consent.value = { name: "QA AI client", redirectUri: "http://127.0.0.1/callback", scopes: ["history:read", "chat:write"] };
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
