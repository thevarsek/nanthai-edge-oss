import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PersonasUpgradePrompt } from "./PersonasUpgradePrompt";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("PersonasUpgradePrompt", () => {
  it("explains the Pro gate and dispatches the upgrade action", () => {
    const onUpgrade = vi.fn();

    render(<PersonasUpgradePrompt onUpgrade={onUpgrade} />);

    expect(screen.getByRole("heading", { name: "personas_pro_feature_title" })).toBeInTheDocument();
    expect(screen.getByText("personas_pro_feature_desc")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "upgrade_to_pro" }));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });
});
