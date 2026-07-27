import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { AIContentReportButton } from "./AIContentReportButton";

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  toast: vi.fn(),
  captureFeatureUsage: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: () => mocks.submit,
}));

vi.mock("@/components/shared/Toast.context", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/lib/featureAnalytics", () => ({
  captureFeatureUsage: mocks.captureFeatureUsage,
}));

describe("AIContentReportButton", () => {
  beforeEach(() => {
    mocks.submit.mockReset();
    mocks.toast.mockReset();
    mocks.captureFeatureUsage.mockReset();
    mocks.submit.mockResolvedValue({
      reportId: "report_1",
      alreadyReported: false,
    });
  });

  it("requires a reason and submits the selected AI message in app", async () => {
    render(<AIContentReportButton messageId={"message_1" as Id<"messages">} />);

    fireEvent.click(screen.getByRole("button", { name: "Report AI response" }));

    const submitButton = screen.getByRole("button", { name: "Submit report" });
    expect(submitButton).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: "Something else" }));
    fireEvent.change(screen.getByPlaceholderText("Add context that may help our review"), {
      target: { value: "Compliance smoke test" },
    });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mocks.submit).toHaveBeenCalledWith({
        messageId: "message_1",
        reason: "other",
        details: "Compliance smoke test",
        platform: "web",
        appVersion: undefined,
      });
    });
    expect(mocks.toast).toHaveBeenCalledWith({
      message: "Report submitted",
      variant: "success",
    });
    expect(mocks.captureFeatureUsage).toHaveBeenCalledWith({
      feature_area: "safety",
      feature: "ai_content_reporting",
      action: "submitted",
      reason: "other",
      message_id: "message_1",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
