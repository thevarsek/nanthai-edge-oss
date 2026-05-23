import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OfflineBanner } from "./OfflineBanner";

let isOnline = true;

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => isOnline,
}));

describe("OfflineBanner", () => {
  it("does not render while online", () => {
    isOnline = true;

    render(<OfflineBanner />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders the offline status message while offline", () => {
    isOnline = false;

    render(<OfflineBanner />);

    expect(screen.getByRole("status")).toHaveTextContent(/offline/i);
  });
});
