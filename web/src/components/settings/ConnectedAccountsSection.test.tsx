import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConnectedAccountsSection } from "./ConnectedAccountsSection";

const connectProviderWithPopup = vi.fn();

vi.mock("@/hooks/useSharedData", () => ({
  useConnectedAccounts: () => ({
    googleConnection: null,
    gmailManualConnection: null,
    microsoftConnection: null,
    notionConnection: null,
    slackConnection: null,
    appleCalendarConnection: null,
    clozeConnection: null,
  }),
}));

vi.mock("convex/react", () => ({
  useAction: () => vi.fn(),
}));

vi.mock("@/lib/providerOAuth", () => ({
  clearOAuthContext: vi.fn(),
  connectProviderWithPopup: (...args: unknown[]) => connectProviderWithPopup(...args),
  getOAuthClientId: () => "client-id",
}));

describe("ConnectedAccountsSection", () => {
  it("locks other OAuth connect buttons while one provider flow is pending", () => {
    connectProviderWithPopup.mockReturnValue(new Promise(() => undefined));
    render(<ConnectedAccountsSection />);

    fireEvent.click(screen.getAllByRole("button", { name: "Connect" })[0]!);

    expect(connectProviderWithPopup).toHaveBeenCalledTimes(1);
    for (const button of screen.getAllByRole("button", { name: "Connect" }).slice(1)) {
      expect(button).toBeDisabled();
    }

    fireEvent.click(screen.getAllByRole("button", { name: "Connect" })[2]!);
    expect(connectProviderWithPopup).toHaveBeenCalledTimes(1);
  });
});
