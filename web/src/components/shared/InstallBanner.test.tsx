import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InstallBanner } from "./InstallBanner";

const installState = vi.hoisted(() => ({
  canInstall: true,
  isIOS: false,
  showBanner: true,
  isInstalling: false,
  install: vi.fn(async () => "accepted" as "accepted" | "dismissed"),
  dismiss: vi.fn(),
}));

vi.mock("@/hooks/usePWAInstall", () => ({
  usePWAInstall: () => installState,
}));

describe("InstallBanner", () => {
  beforeEach(() => {
    installState.canInstall = true;
    installState.isIOS = false;
    installState.showBanner = true;
    installState.isInstalling = false;
    installState.install.mockReset().mockResolvedValue("accepted");
    installState.dismiss.mockClear();
  });

  it("hides when the PWA prompt should not be shown", () => {
    installState.showBanner = false;

    render(<InstallBanner />);

    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  });

  it("dismisses after an accepted native install prompt and keeps banner open after dismissal", async () => {
    render(<InstallBanner />);

    fireEvent.click(screen.getByRole("button", { name: /^install$/i }));
    await waitFor(() => expect(installState.install).toHaveBeenCalledTimes(1));
    expect(installState.dismiss).toHaveBeenCalledTimes(1);

    installState.dismiss.mockClear();
    installState.install.mockResolvedValueOnce("dismissed");
    fireEvent.click(screen.getByRole("button", { name: /^install$/i }));
    await waitFor(() => expect(installState.install).toHaveBeenCalledTimes(2));
    expect(installState.dismiss).not.toHaveBeenCalled();
  });

  it("keeps the install banner retryable when the native prompt fails", async () => {
    installState.install.mockRejectedValueOnce(new Error("prompt failed"));

    render(<InstallBanner />);

    fireEvent.click(screen.getByRole("button", { name: /^install$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Install prompt failed. Please try again.");
    expect(installState.install).toHaveBeenCalledTimes(1);
    expect(installState.dismiss).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^install$/i })).toBeEnabled();
  });

  it("shows iOS manual instructions without a native install action", () => {
    installState.canInstall = false;
    installState.isIOS = true;

    render(<InstallBanner />);

    expect(screen.getByRole("banner", { name: /install nanthai edge/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^install$/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /dismiss install prompt/i }));
    expect(installState.dismiss).toHaveBeenCalledTimes(1);
  });
});
