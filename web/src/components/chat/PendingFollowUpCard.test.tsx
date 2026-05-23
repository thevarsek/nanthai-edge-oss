import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PendingFollowUpCard } from "./PendingFollowUpCard";

describe("PendingFollowUpCard", () => {
  it("disables every queued action while another send is in flight", () => {
    const onEdit = vi.fn();
    const onSendNow = vi.fn();
    const onRemove = vi.fn();

    render(
      <PendingFollowUpCard
        text="follow up later"
        actionsDisabled
        onEdit={onEdit}
        onSendNow={onSendNow}
        onRemove={onRemove}
      />,
    );

    for (const name of [
      "Edit queued message",
      "Send now",
      "Dismiss queued message",
    ]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }

    expect(onEdit).not.toHaveBeenCalled();
    expect(onSendNow).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
  });
});
