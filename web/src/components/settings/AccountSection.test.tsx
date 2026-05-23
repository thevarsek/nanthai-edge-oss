import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccountSection } from "./AccountSection";

vi.mock("@clerk/react", () => ({
  useUser: () => ({
    user: {
      fullName: "Dana Test",
      username: null,
      primaryEmailAddress: { emailAddress: "dana@example.com" },
      imageUrl: "https://example.com/avatar.png",
    },
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("AccountSection", () => {
  it("does not submit an enclosing form when opening the profile row", () => {
    const onSubmit = vi.fn();
    const onShowProfile = vi.fn();

    render(
      <form onSubmit={onSubmit}>
        <AccountSection onShowProfile={onShowProfile} />
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: /dana test/i }));

    expect(onShowProfile).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
