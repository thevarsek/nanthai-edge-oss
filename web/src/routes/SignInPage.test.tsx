import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignInPage } from "./SignInPage";

const { signInMock, captureAnalyticsMock } = vi.hoisted(() => ({
  signInMock: vi.fn(),
  captureAnalyticsMock: vi.fn(),
}));

vi.mock("@clerk/react", () => ({
  SignIn: (props: { routing: string; path: string }) => {
    signInMock(props);
    return <div>clerk-sign-in</div>;
  },
}));

vi.mock("@/lib/analytics", () => ({
  captureAnalytics: captureAnalyticsMock,
}));

describe("SignInPage", () => {
  beforeEach(() => {
    signInMock.mockClear();
    captureAnalyticsMock.mockClear();
  });

  it("keeps Clerk path routing aligned with the /sign-in route", () => {
    render(<SignInPage />);

    expect(screen.getByText("clerk-sign-in")).toBeInTheDocument();
    expect(signInMock).toHaveBeenCalledWith(expect.objectContaining({
      routing: "path",
      path: "/sign-in",
    }));
    expect(captureAnalyticsMock).toHaveBeenCalledWith("sign_in_started", {
      feature_area: "auth",
      source: "web_sign_in",
    });
  });
});
