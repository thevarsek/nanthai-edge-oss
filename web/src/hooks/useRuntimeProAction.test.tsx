import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { useRuntimeProAction } from "./useRuntimeProAction";

const { state, action } = vi.hoisted(() => ({ state: { proStatus: { isPro: false } as { isPro: boolean } | undefined }, action: vi.fn() }));
vi.mock("@/hooks/useSharedData", () => ({ useSharedData: () => state }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("convex/react", () => ({ useAction: () => vi.fn() }));
vi.mock("@convex/_generated/api", () => ({ api: { stripe: { actions: { createCheckoutSession: "checkout" } } } }));
beforeEach(() => { state.proStatus = { isPro: false }; action.mockReset(); });

function Harness({ promptOnEntry = false }: { promptOnEntry?: boolean }) {
  const gate = useRuntimeProAction({ kind: "local-runtime" }, { resume: action, promptOnEntry });
  return <><button disabled={gate.loading || gate.waiting} onClick={() => gate.run(action)}>Pair Mac</button>{gate.paywall}{gate.status}</>;
}
function page(path = "/app/settings/local-runtime") {
  const content = () => <MemoryRouter initialEntries={[path]}><Harness /></MemoryRouter>;
  return { ...render(content()), content };
}

it("does not run during entitlement loading or after a cancelled paywall", async () => {
  state.proStatus = undefined;
  const view = page();
  expect(screen.getByRole("button", { name: "Pair Mac" })).toBeDisabled();
  state.proStatus = { isPro: false }; view.rerender(view.content());
  fireEvent.click(screen.getByRole("button", { name: "Pair Mac" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(action).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close paywall" }));
  state.proStatus = { isPro: true }; view.rerender(view.content());
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(action).not.toHaveBeenCalled();
});

it("keeps the requested action through restore and resumes once when Convex confirms Pro", async () => {
  const view = page();
  fireEvent.click(screen.getByRole("button", { name: "Pair Mac" }));
  fireEvent.click(screen.getByRole("button", { name: "restore_purchase" }));
  expect(screen.getByRole("status")).toHaveTextContent("runtime_pro_restore_help");
  expect(screen.getByRole("button", { name: "get_nanthai_pro" })).toBeEnabled();
  expect(action).not.toHaveBeenCalled();
  state.proStatus = { isPro: true }; view.rerender(view.content());
  await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  view.rerender(view.content());
  expect(action).toHaveBeenCalledTimes(1);
});

it("checkout success alone does not grant Pro and cancellation stops deferred setup", async () => {
  const view = page("/app/settings/local-runtime?pro=success");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(action).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "cancel" }));
  state.proStatus = { isPro: true }; view.rerender(view.content());
  await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  expect(action).not.toHaveBeenCalled();
});

it("a cancelled checkout leaves management available and does not automatically restart pairing", () => {
  const content = () => <MemoryRouter initialEntries={["/app/settings/local-runtime?pro=cancelled"]}><Harness promptOnEntry /></MemoryRouter>;
  const view = render(content());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  state.proStatus = { isPro: true }; view.rerender(content());
  expect(action).not.toHaveBeenCalled();
});
