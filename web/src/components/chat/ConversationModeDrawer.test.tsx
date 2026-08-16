import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConversationModeDrawer } from "./ConversationModeDrawer";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("ConversationModeDrawer", () => {
  it("selects Collaboration and keeps Autonomous configuration separate", async () => {
    const onSelectBehavior = vi.fn(async () => true);
    const onConfigureAutonomous = vi.fn();
    const onClose = vi.fn();
    render(
      <ConversationModeDrawer
        behavior="parallel"
        autonomousActive={false}
        hasMessages
        isPro
        isUpdating={false}
        error={null}
        onSelectBehavior={onSelectBehavior}
        onConfigureAutonomous={onConfigureAutonomous}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /collaboration_label/i }));
    await waitFor(() => expect(onSelectBehavior).toHaveBeenCalledWith("collaboration"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfigureAutonomous).not.toHaveBeenCalled();
  });

  it("opens the existing Autonomous setup instead of starting it directly", () => {
    const onConfigureAutonomous = vi.fn();
    render(
      <ConversationModeDrawer
        behavior="parallel"
        autonomousActive={false}
        hasMessages
        isPro
        isUpdating={false}
        error={null}
        onSelectBehavior={vi.fn(async () => true)}
        onConfigureAutonomous={onConfigureAutonomous}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /autonomous_discussion/i }));
    expect(onConfigureAutonomous).toHaveBeenCalledTimes(1);
  });
});
