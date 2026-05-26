import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectedAccountsSection } from "./ConnectedAccountsSection";

const connectProviderWithPopup = vi.fn();
const disconnectGoogle = vi.fn();
let connectedAccounts = {
  googleConnection: null as { hasDrive: boolean; hasCalendar: boolean } | null,
  gmailManualConnection: null,
  microsoftConnection: null,
  notionConnection: null,
  slackConnection: null,
  appleCalendarConnection: null,
  clozeConnection: null,
};

vi.mock("@/hooks/useSharedData", () => ({
  useConnectedAccounts: () => connectedAccounts,
}));

vi.mock("convex/react", () => ({
  useAction: () => disconnectGoogle,
}));

vi.mock("@/lib/providerOAuth", () => ({
  clearOAuthContext: vi.fn(),
  connectProviderWithPopup: (...args: unknown[]) => connectProviderWithPopup(...args),
  getOAuthClientId: () => "client-id",
}));

describe("ConnectedAccountsSection", () => {
  beforeEach(() => {
    connectedAccounts = {
      googleConnection: null,
      gmailManualConnection: null,
      microsoftConnection: null,
      notionConnection: null,
      slackConnection: null,
      appleCalendarConnection: null,
      clozeConnection: null,
    };
    connectProviderWithPopup.mockReset();
    disconnectGoogle.mockReset();
  });

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

  it("does not fire disconnect twice before busy state renders", () => {
    connectedAccounts = {
      ...connectedAccounts,
      googleConnection: { hasDrive: true, hasCalendar: true },
    };
    disconnectGoogle.mockReturnValue(new Promise(() => undefined));
    render(<ConnectedAccountsSection />);

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    const confirm = screen.getAllByRole("button", { name: "Disconnect" }).at(-1)!;
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(disconnectGoogle).toHaveBeenCalledTimes(1);
  });
});
