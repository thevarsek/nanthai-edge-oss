import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConversationModeDrawer } from "./ConversationModeDrawer";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function setup(autonomousActive = false) {
  const onSelectBehavior = vi.fn(async () => true);
  const onClose = vi.fn();
  const start = vi.fn();
  render(<ConversationModeDrawer behavior="parallel" autonomousActive={autonomousActive} hasMessages isPro
    isUpdating={false} error={null} onSelectBehavior={onSelectBehavior} onClose={onClose}
    autonomousControls={<button onClick={start}>Start discussion</button>} />);
  return { onSelectBehavior, onClose, start };
}

describe("ConversationModeDrawer", () => {
  it("previews all modes and applies only the final choice", async () => {
    const { onSelectBehavior, onClose, start } = setup();
    fireEvent.click(screen.getByRole("radio", { name: /collaboration_label/i }));
    fireEvent.click(screen.getByRole("radio", { name: /autonomous_discussion/i }));
    expect(screen.getByRole("button", { name: "Start discussion" })).toBeVisible();
    expect(start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: /parallel_label/i }));
    expect(screen.queryByRole("button", { name: "Start discussion" })).not.toBeInTheDocument();
    expect(onSelectBehavior).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "use_conversation_mode" }));
    await waitFor(() => expect(onSelectBehavior).toHaveBeenCalledWith("parallel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closing a preview does not apply it", () => {
    const { onSelectBehavior, onClose, start } = setup();
    fireEvent.click(screen.getByRole("radio", { name: /collaboration_label/i }));
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSelectBehavior).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it("allows browsing during an active discussion without changing its mode", () => {
    const { onSelectBehavior } = setup(true);
    fireEvent.click(screen.getByRole("radio", { name: /parallel_label/i }));
    expect(screen.getByRole("button", { name: "use_conversation_mode" })).toBeDisabled();
    expect(onSelectBehavior).not.toHaveBeenCalled();
  });
});
