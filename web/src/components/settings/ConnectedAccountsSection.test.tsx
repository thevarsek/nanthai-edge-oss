import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { ConnectedAccountsSection } from "./ConnectedAccountsSection";

const connectProviderWithPopup = vi.fn();
const disconnectGoogle = vi.fn();
const disconnectGmailManual = vi.fn();
const disconnectMicrosoft = vi.fn();
const disconnectNotion = vi.fn();
const disconnectSlack = vi.fn();
const disconnectAppleCalendar = vi.fn();
const disconnectCloze = vi.fn();
const connectGmailManual = vi.fn();
const connectAppleCalendar = vi.fn();
const connectCloze = vi.fn();
const clearOAuthContext = vi.fn();
let oauthClientId: string | null = "client-id";

type GoogleConnection = {
  status?: string;
  hasDrive: boolean;
  hasCalendar: boolean;
} | null | undefined;

type StatusConnection = {
  status?: string;
  errorMessage?: string | null;
} | null | undefined;

type ConnectedAccountsMock = {
  googleConnection: GoogleConnection;
  gmailManualConnection: StatusConnection;
  microsoftConnection: StatusConnection;
  notionConnection: StatusConnection;
  slackConnection: StatusConnection;
  appleCalendarConnection: StatusConnection;
  clozeConnection: StatusConnection;
};

type StatusConnectionKey =
  | "microsoftConnection"
  | "notionConnection"
  | "slackConnection"
  | "appleCalendarConnection";

let connectedAccounts: ConnectedAccountsMock = {
  googleConnection: null as { hasDrive: boolean; hasCalendar: boolean } | null,
  gmailManualConnection: null,
  microsoftConnection: null,
  notionConnection: null,
  slackConnection: null,
  appleCalendarConnection: null,
  clozeConnection: null,
};
const actionSpies: Record<string, ReturnType<typeof vi.fn>> = {
  "oauth/apple_calendar:connectAppleCalendar": connectAppleCalendar,
  "oauth/apple_calendar:disconnectAppleCalendar": disconnectAppleCalendar,
  "oauth/cloze:connectCloze": connectCloze,
  "oauth/cloze:disconnectCloze": disconnectCloze,
  "oauth/gmail_manual_actions:connectGmailManual": connectGmailManual,
  "oauth/gmail_manual_actions:disconnectGmailManual": disconnectGmailManual,
  "oauth/google:disconnectGoogle": disconnectGoogle,
  "oauth/microsoft:disconnectMicrosoft": disconnectMicrosoft,
  "oauth/notion:disconnectNotion": disconnectNotion,
  "oauth/slack:disconnectSlack": disconnectSlack,
};

vi.mock("@/hooks/useSharedData", () => ({
  useConnectedAccounts: () => connectedAccounts,
}));

vi.mock("convex/react", () => ({
  useAction: (action: unknown) => {
    const name = getFunctionName(action as Parameters<typeof getFunctionName>[0]);
    const spy = actionSpies[name];
    if (!spy) throw new Error(`Unconfigured action mock: ${name}`);
    return spy;
  },
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
    for (const spy of Object.values(actionSpies)) spy.mockReset();
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
      googleConnection: { status: "active", hasDrive: true, hasCalendar: true },
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

  it("keeps account rows inert while connection queries are loading", () => {
    connectedAccounts = {
      googleConnection: undefined,
      gmailManualConnection: undefined,
      microsoftConnection: undefined,
      notionConnection: undefined,
      slackConnection: undefined,
      appleCalendarConnection: undefined,
      clozeConnection: undefined,
    };
    render(<ConnectedAccountsSection />);

    for (const label of ["Google Workspace", "Gmail", "Microsoft 365", "Notion", "Slack", "Apple Calendar", "Cloze CRM"]) {
      expect(rowButton(label, /Loading/i)).toBeDisabled();
    }

    fireEvent.click(rowButton("Google Workspace", /Loading/i));
    fireEvent.click(rowButton("Apple Calendar", /Loading/i));

    expect(connectProviderWithPopup).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Connect Apple Calendar" })).not.toBeInTheDocument();
  });

  it.each([
    { label: "Microsoft 365", key: "microsoftConnection", provider: "microsoft" },
    { label: "Notion", key: "notionConnection", provider: "notion" },
    { label: "Slack", key: "slackConnection", provider: "slack" },
    { label: "Apple Calendar", key: "appleCalendarConnection", provider: null },
  ] satisfies Array<{
    label: string;
    key: StatusConnectionKey;
    provider: "microsoft" | "notion" | "slack" | null;
  }>)("renders $label non-active statuses as reconnectable", async ({ label, key, provider }) => {
    connectedAccounts = {
      ...connectedAccounts,
      [key]: { status: "expired", errorMessage: "Token refresh failed." },
    };
    render(<ConnectedAccountsSection />);

    expect(within(accountRow(label)).queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
    const connect = rowButton(label, "Connect");
    expect(connect).not.toBeDisabled();
    fireEvent.click(connect);

    if (provider) {
      await waitFor(() => expect(connectProviderWithPopup).toHaveBeenCalledWith(provider, undefined));
    } else {
      expect(screen.getByRole("heading", { name: "Connect Apple Calendar" })).toBeInTheDocument();
    }
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
    connectGmailManual.mockResolvedValue(undefined);
    connectAppleCalendar.mockResolvedValue(undefined);
    connectCloze.mockResolvedValue(undefined);
    render(<ConnectedAccountsSection />);

    fireEvent.click(rowButton("Gmail", "Connect"));
    let modal = modalByHeading("Connect Gmail");
    fireEvent.change(within(modal).getByPlaceholderText("Gmail address"), { target: { value: "user@gmail.com" } });
    fireEvent.change(within(modal).getByPlaceholderText("Google app password"), { target: { value: "app-password" } });
    fireEvent.click(within(modal).getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(connectGmailManual).toHaveBeenCalledWith({
      email: "user@gmail.com",
      appPassword: "app-password",
    }));
    expect(connectAppleCalendar).not.toHaveBeenCalled();
    expect(connectCloze).not.toHaveBeenCalled();

    fireEvent.click(rowButton("Apple Calendar", "Connect"));
    modal = modalByHeading("Connect Apple Calendar");
    fireEvent.change(within(modal).getByPlaceholderText(/Apple Account Email/i), { target: { value: "apple@example.com" } });
    fireEvent.change(within(modal).getByPlaceholderText(/App-Specific Password/i), { target: { value: "apple-password" } });
    fireEvent.click(within(modal).getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(connectAppleCalendar).toHaveBeenCalledWith({
      appleId: "apple@example.com",
      appSpecificPassword: "apple-password",
    }));
    expect(connectCloze).not.toHaveBeenCalled();

    fireEvent.click(rowButton("Cloze CRM", "Connect"));
    modal = modalByHeading("Connect Cloze CRM");
    fireEvent.change(within(modal).getByPlaceholderText("API Key"), { target: { value: "cloze-key" } });
    fireEvent.change(within(modal).getByPlaceholderText("Label (optional)"), { target: { value: "Work CRM" } });
    fireEvent.click(within(modal).getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(connectCloze).toHaveBeenCalledWith({
      apiKey: "cloze-key",
      label: "Work CRM",
    }));
    expect(disconnectGoogle).not.toHaveBeenCalled();
  });

  it("shows action errors and keeps manual modals open for retry", async () => {
    connectGmailManual.mockRejectedValueOnce(new Error("bad password"));
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
