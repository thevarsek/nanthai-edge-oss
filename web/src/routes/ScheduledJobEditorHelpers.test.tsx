import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StepIntegrationsSection } from "./ScheduledJobEditorHelpers";
import { createDraftStep } from "./ScheduledJobEditor.model";

vi.mock("@/hooks/useSharedData", () => ({
  useConnectedAccounts: () => ({
    googleConnection: { hasDrive: false, hasCalendar: false },
    gmailManualConnection: null,
    microsoftConnection: null,
    appleCalendarConnection: null,
    notionConnection: null,
    clozeConnection: null,
    slackConnection: null,
  }),
  useModelSummaries: () => [],
  useSharedData: () => ({}),
}));

vi.mock("@/components/shared/Toast.context", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe("StepIntegrationsSection", () => {
  it("shows Google Drive and Calendar rows when Google is connected but scopes are missing", () => {
    render(<StepIntegrationsSection step={createDraftStep()} onChange={vi.fn()} />);

    expect(screen.getByText("Google Drive")).toBeInTheDocument();
    expect(screen.getByText("Google Calendar")).toBeInTheDocument();
  });
});
