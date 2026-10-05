import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { RuntimeProRecoveryNotice } from "./RuntimeProRecoveryNotice";

const { state } = vi.hoisted(() => ({ state: { hasApiKey: false, prefs: { runtimeOnboardingState: "setup" as string | undefined }, proStatus: { isPro: false } } }));
vi.mock("@/hooks/useSharedData", () => ({ useSharedData: () => state, useOpenRouterStatus: () => state.hasApiKey }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
beforeEach(() => { state.hasApiKey = false; state.prefs.runtimeOnboardingState = "setup"; state.proStatus.isPro = false; });
function page(path = "/app/chat") {
  return render(<MemoryRouter initialEntries={[path]}><RuntimeProRecoveryNotice /></MemoryRouter>);
}

it("offers existing local-only free users purchase or OpenRouter recovery without hiding history", () => {
  page();
  expect(screen.getByText("runtime_pro_purchase_help")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "get_nanthai_pro" })).toHaveAttribute("href", "/app/settings/local-runtime");
  expect(screen.getByRole("link", { name: "connect_openrouter" })).toHaveAttribute("href", "/onboarding?mode=connections");
});
it("does not show a recovery prompt for existing Pro or cloud-only users", () => {
  state.proStatus.isPro = true;
  const view = page();
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  view.unmount();
  state.proStatus.isPro = false; state.prefs.runtimeOnboardingState = undefined;
  page();
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
});
it("lets the Local Runtime page own its purchase and device-management flow", () => {
  page("/app/settings/local-runtime");
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
});
it("stops showing recovery once the user connects OpenRouter", () => {
  state.hasApiKey = true;
  page();
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
});
