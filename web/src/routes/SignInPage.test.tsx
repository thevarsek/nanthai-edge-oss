import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SignInPage } from "./SignInPage";

const signInMock = vi.fn();

vi.mock("@clerk/react", () => ({
  SignIn: (props: { routing: string; path: string }) => {
    signInMock(props);
    return <div>clerk-sign-in</div>;
  },
}));

describe("SignInPage", () => {
  it("keeps Clerk path routing aligned with the /sign-in route", () => {
    render(<SignInPage />);

    expect(screen.getByText("clerk-sign-in")).toBeInTheDocument();
    expect(signInMock).toHaveBeenCalledWith(expect.objectContaining({
      routing: "path",
      path: "/sign-in",
    }));
  });
});
