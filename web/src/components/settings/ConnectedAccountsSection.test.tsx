import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectedAccountsSection } from "./ConnectedAccountsSection";

const connectProviderWithPopup = vi.fn();
const disconnectGoogle = vi.fn();
const clearOAuthContext = vi.fn();
let oauthClientId: string | null = "client-id";
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
  clearOAuthContext: (...args: unknown[]) => clearOAuthContext(...args),
  connectProviderWithPopup: (...args: unknown[]) => connectProviderWithPopup(...args),
  getOAuthClientId: () => oauthClientId,
}));

function accountRow(label: string | RegExp) {
  const row = screen.getByText(label).closest(".flex.items-center.gap-3.px-4.py-3");
  if (!(row instanceof HTMLElement)) throw new Error(`Missing account row for ${String(label)}`);
  return row;
}

function rowButton(label: string | RegExp, name: string | RegExp) {
  return within(accountRow(label)).getByRole("button", { name });
}

function modalByHeading(heading: string | RegExp) {
  const modal = screen.getByRole("heading", { name: heading }).closest(".fixed.inset-0");
  if (!(modal instanceof HTMLElement)) throw new Error(`Missing modal for ${String(heading)}`);
  return modal;
}

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
    clearOAuthContext.mockReset();
    oauthClientId = "client-id";
  });

  it("locks other OAuth connect buttons while one provider flow is pending", () => {
    connectProviderWithPopup.mockReturnValue(new Promise(() => undefined));
    render(<ConnectedAccountsSection />);

    fireEvent.click(rowButton("Google Workspace", "Connect"));

    expect(connectProviderWithPopup).toHaveBeenCalledTimes(1);
    expect(rowButton("Microsoft 365", "Connect")).toBeDisabled();
    expect(rowButton("Notion", "Connect")).toBeDisabled();
    expect(rowButton("Slack", "Connect")).toBeDisabled();

    fireEvent.click(rowButton("Notion", "Connect"));
    expect(connectProviderWithPopup).toHaveBeenCalledTimes(1);
  });

  it("does not fire disconnect twice before busy state renders", () => {
    connectedAccounts = {
      ...connectedAccounts,
      googleConnection: { hasDrive: true, hasCalendar: true },
    };
    disconnectGoogle.mockReturnValue(new Promise(() => undefined));
    render(<ConnectedAccountsSection />);

    fireEvent.click(rowButton("Google Workspace", "Disconnect"));
    const dialog = screen.getByRole("dialog", { name: /Disconnect Google/i });
    const confirm = within(dialog).getByRole("button", { name: "Disconnect" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(disconnectGoogle).toHaveBeenCalledTimes(1);
  });

  it("opens OAuth providers with provider-specific args and reports setup or popup failures", async () => {
    connectProviderWithPopup.mockResolvedValue(undefined);
    const { rerender } = render(<ConnectedAccountsSection />);

    fireEvent.click(rowButton("Google Workspace", "Connect"));
    await waitFor(() => expect(connectProviderWithPopup).toHaveBeenCalledWith("google", { requestedIntegration: "workspace" }));

    fireEvent.click(rowButton("Notion", "Connect"));
    await waitFor(() => expect(connectProviderWithPopup).toHaveBeenCalledWith("notion", undefined));

    oauthClientId = null;
    rerender(<ConnectedAccountsSection />);
    fireEvent.click(rowButton("Notion", "Connect"));
    expect(await screen.findByText(/Notion OAuth is not configured/i)).toBeInTheDocument();

    oauthClientId = "client-id";
    connectProviderWithPopup.mockRejectedValueOnce(new Error("denied"));
    rerender(<ConnectedAccountsSection />);
    fireEvent.click(rowButton("Slack", "Connect"));
    await waitFor(() => expect(clearOAuthContext).toHaveBeenCalledWith("slack"));
    expect(await screen.findByText(/denied|cancelled|canceled|failed/i)).toBeInTheDocument();
  });

  it("connects manual Gmail, Apple Calendar, and Cloze with form payloads", async () => {
    disconnectGoogle.mockResolvedValue(undefined);
    render(<ConnectedAccountsSection />);

    fireEvent.click(rowButton("Gmail", "Connect"));
    let modal = modalByHeading("Connect Gmail");
    fireEvent.change(within(modal).getByPlaceholderText("Gmail address"), { target: { value: "user@gmail.com" } });
    fireEvent.change(within(modal).getByPlaceholderText("Google app password"), { target: { value: "app-password" } });
    fireEvent.click(within(modal).getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(disconnectGoogle).toHaveBeenCalledWith({
      email: "user@gmail.com",
      appPassword: "app-password",
    }));

    fireEvent.click(rowButton("Apple Calendar", "Connect"));
    modal = modalByHeading("Connect Apple Calendar");
    fireEvent.change(within(modal).getByPlaceholderText(/Apple Account Email/i), { target: { value: "apple@example.com" } });
    fireEvent.change(within(modal).getByPlaceholderText(/App-Specific Password/i), { target: { value: "apple-password" } });
    fireEvent.click(within(modal).getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(disconnectGoogle).toHaveBeenCalledWith({
      appleId: "apple@example.com",
      appSpecificPassword: "apple-password",
    }));

    fireEvent.click(rowButton("Cloze CRM", "Connect"));
    modal = modalByHeading("Connect Cloze CRM");
    fireEvent.change(within(modal).getByPlaceholderText("API Key"), { target: { value: "cloze-key" } });
    fireEvent.change(within(modal).getByPlaceholderText("Label (optional)"), { target: { value: "Work CRM" } });
    fireEvent.click(within(modal).getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(disconnectGoogle).toHaveBeenCalledWith({
      apiKey: "cloze-key",
      label: "Work CRM",
    }));
  });

  it("shows action errors and keeps manual modals open for retry", async () => {
    disconnectGoogle.mockRejectedValueOnce(new Error("bad password"));
    render(<ConnectedAccountsSection />);

    fireEvent.click(rowButton("Gmail", "Connect"));
    const modal = modalByHeading("Connect Gmail");
    fireEvent.change(within(modal).getByPlaceholderText("Gmail address"), { target: { value: "user@gmail.com" } });
    fireEvent.change(within(modal).getByPlaceholderText("Google app password"), { target: { value: "bad-password" } });
    fireEvent.click(within(modal).getByRole("button", { name: "Connect" }));

    expect(await screen.findByText(/bad password|failed/i)).toBeInTheDocument();
    expect(within(modal).getByPlaceholderText("Gmail address")).toHaveValue("user@gmail.com");
  });
});
