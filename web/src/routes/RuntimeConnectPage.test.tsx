import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { RuntimeConnectPage } from "./RuntimeConnectPage";
import { runtimePairingLink } from "@/lib/runtimePairingLink";

const { begin, pro } = vi.hoisted(() => ({ begin: vi.fn(), pro: { isPro: true } }));
vi.mock("@clerk/react", () => ({ useUser: () => ({ user: { primaryEmailAddress: { emailAddress: "review@example.test" } } }) }));
vi.mock("@/hooks/useSharedData", () => ({ useSharedData: () => ({ proStatus: pro }) }));
vi.mock("@/components/shared/PaywallModal", () => ({ PaywallModal: ({ onClose }: { onClose: () => void }) => <div role="dialog"><button onClick={onClose}>Close paywall</button></div> }));
vi.mock("convex/react", () => ({ useMutation: () => begin }));
vi.mock("@convex/_generated/api", () => ({ api: { runtime_host: { pairing: { beginPairing: "begin" } } } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const session = { pairingId: "pairing_qa", oneTimeCode: "nrp_secret", expiresAt: 1000, serverOrigin: "https://dev.convex.site" };
function page(query = "?state=01234567-89ab-cdef&computer=QA%20Mac") {
  render(<MemoryRouter initialEntries={[`/runtime/connect${query}`]}><RuntimeConnectPage /></MemoryRouter>);
}
beforeEach(() => { begin.mockReset(); pro.isPro = true; });

it("shows the account and Mac before a user-created grant and returns an environment-bound app link", async () => {
  begin.mockResolvedValue(session);
  page();
  expect(screen.getByText("review@example.test")).toBeInTheDocument();
  expect(screen.getByText("QA Mac")).toBeInTheDocument();
  expect(begin).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "runtime_connect_confirm" }));
  const link = await screen.findByRole("link", { name: "runtime_connect_return" });
  const url = new URL(link.getAttribute("href") ?? "");
  expect(url.protocol).toBe("nanthai-runtime:");
  expect(url.searchParams.get("server")).toBe("https://dev.convex.site");
  expect(url.searchParams.get("state")).toBe("01234567-89ab-cdef");
  expect(url.searchParams.get("pairingId")).toBe(session.pairingId);
});

it("retains errors without creating a return link", async () => {
  begin.mockRejectedValue(new Error("Connection failed"));
  page();
  fireEvent.click(screen.getByRole("button", { name: "runtime_connect_confirm" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection failed");
  expect(screen.queryByRole("link", { name: "runtime_connect_return" })).not.toBeInTheDocument();
});

it("rejects missing state and credential-bearing handoff origins", () => {
  page("");
  expect(screen.getByRole("alert")).toHaveTextContent("runtime_connect_restart");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(() => runtimePairingLink({ ...session, serverOrigin: "https://user:secret@dev.convex.site" }, "01234567-89ab-cdef")).toThrow();
});

it("shows the paywall before granting a free Mac connection and allows switching providers", () => {
  pro.isPro = false;
  page();
  fireEvent.click(screen.getByRole("button", { name: "runtime_connect_confirm" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(begin).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close paywall" }));
  expect(screen.getByRole("link", { name: "runtime_choose_connection" })).toHaveAttribute("href", "/onboarding?mode=connections");
  expect(begin).not.toHaveBeenCalled();
});

it("returns from checkout with the same Mac state and connects only after Pro is confirmed", async () => {
  pro.isPro = false;
  begin.mockResolvedValue(session);
  const view = render(<MemoryRouter initialEntries={["/runtime/connect?state=01234567-89ab-cdef&computer=QA%20Mac&pro=success"]}><RuntimeConnectPage /></MemoryRouter>);
  expect(begin).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent("runtime_pro_confirming");
  pro.isPro = true;
  view.rerender(<MemoryRouter initialEntries={["/runtime/connect?state=01234567-89ab-cdef&computer=QA%20Mac&pro=success"]}><RuntimeConnectPage /></MemoryRouter>);
  const link = await screen.findByRole("link", { name: "runtime_connect_return" });
  expect(begin).toHaveBeenCalledTimes(1);
  expect(new URL(link.getAttribute("href") ?? "").searchParams.get("state")).toBe("01234567-89ab-cdef");
});
