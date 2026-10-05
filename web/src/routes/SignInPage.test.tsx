import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignInPage } from "./SignInPage";
import { MemoryRouter } from "react-router-dom";

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
    render(<MemoryRouter><SignInPage /></MemoryRouter>);

    expect(screen.getByText("clerk-sign-in")).toBeInTheDocument();
    expect(signInMock).toHaveBeenCalledWith(expect.objectContaining({
      routing: "path",
      path: "/sign-in",
      forceRedirectUrl: "/app",
    }));
    expect(captureAnalyticsMock).toHaveBeenCalledWith("sign_in_started", {
      feature_area: "auth",
      source: "web_sign_in",
    });
  });

  it("returns browser pairing to account confirmation after Clerk sign-in", () => {
    const target = "/runtime/connect?state=01234567-89abcdef&computer=QA%20Mac";
    render(<MemoryRouter initialEntries={[`/sign-in?redirect_url=${encodeURIComponent(target)}`]}><SignInPage /></MemoryRouter>);
    expect(signInMock).toHaveBeenCalledWith(expect.objectContaining({ forceRedirectUrl: target }));
  });

  it("keeps unrelated redirect requests on the existing app destination", () => {
    render(<MemoryRouter initialEntries={["/sign-in?redirect_url=https%3A%2F%2Fexample.com"]}><SignInPage /></MemoryRouter>);
    expect(signInMock).toHaveBeenCalledWith(expect.objectContaining({ forceRedirectUrl: "/app" }));
  });
  it("returns external MCP sign-in to its consent screen", () => {
    const target = "/mcp/authorize?request=qa";
    render(<MemoryRouter initialEntries={[`/sign-in?redirect_url=${encodeURIComponent(target)}`]}><SignInPage /></MemoryRouter>);
    expect(signInMock).toHaveBeenCalledWith(expect.objectContaining({ forceRedirectUrl: target }));
  });
});
