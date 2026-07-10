import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatPlusMenu } from "./ChatPlusMenu";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

describe("ChatPlusMenu", () => {
  it("renders conditional pro menu states and ignores disabled tools", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <ChatPlusMenu
        onSelect={onSelect}
        onClose={onClose}
        isPro
        hasMessages
        participantCount={1}
        hasConnectedIntegrations
        allParticipantsSupportTools={false}
        clipboardHasImage
        badges={{ parameters: 2, subagents: 1, integrations: 1, skills: 1 }}
      />,
    );

    expect(screen.getByRole("button", { name: /chat_parameters_on/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /paste image/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /subagents_on/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /integrations/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /skills/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /subagents_on/i }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /participants/i }));
    expect(onSelect).toHaveBeenCalledWith("participants");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows autonomous only for pro multi-participant chats with messages", () => {
    const { rerender } = render(
      <ChatPlusMenu
        onSelect={vi.fn()}
        onClose={vi.fn()}
        isPro
        hasMessages
        participantCount={2}
      />,
    );

    expect(screen.getByRole("button", { name: /autonomous_discussion/i })).toBeInTheDocument();

    rerender(
      <ChatPlusMenu
        onSelect={vi.fn()}
        onClose={vi.fn()}
        isPro
        hasMessages={false}
        participantCount={2}
      />,
    );

    expect(screen.queryByRole("button", { name: /autonomous_discussion/i })).not.toBeInTheDocument();
  });

  it("keeps Advisors discoverable for free users with a Pro badge", () => {
    const onSelect = vi.fn();
    render(<ChatPlusMenu onSelect={onSelect} onClose={vi.fn()} isPro={false} />);

    const advisors = screen.getByRole("button", { name: /advisors/i });
    expect(advisors).toHaveTextContent("PRO");
    fireEvent.click(advisors);
    expect(onSelect).toHaveBeenCalledWith("advisors");
  });
});
