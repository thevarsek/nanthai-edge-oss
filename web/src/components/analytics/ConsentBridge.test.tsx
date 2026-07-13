import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ConsentBridge } from "./ConsentBridge";

vi.mock("./PublicConsentManager", () => ({
  default: () => <div>public-consent-manager</div>,
}));

describe("ConsentBridge", () => {
  it("renders the consent manager on public website routes", async () => {
    render(
      <MemoryRouter initialEntries={["/features/search"]}>
        <ConsentBridge />
      </MemoryRouter>,
    );

    expect(await screen.findByText("public-consent-manager")).toBeInTheDocument();
  });

  it.each(["/app", "/chat/abc", "/sign-in", "/onboarding"])(
    "never renders consent UI inside %s",
    (path) => {
      render(
        <MemoryRouter initialEntries={[path]}>
          <ConsentBridge />
        </MemoryRouter>,
      );

      expect(screen.queryByText("public-consent-manager")).not.toBeInTheDocument();
    },
  );
});
