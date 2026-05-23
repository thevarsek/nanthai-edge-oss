import { render, screen, waitFor } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenRouterCallbackPage } from "./OpenRouterCallbackPage";

function renderCallback(search: string) {
  window.history.pushState({}, "", `/openrouter/edge/callback${search}`);
  const replace = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      ...window.location,
      search,
      replace,
    },
  });

  render(
    <HelmetProvider>
      <OpenRouterCallbackPage />
    </HelmetProvider>,
  );

  return replace;
}

describe("OpenRouterCallbackPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves OAuth success callback parameters in redirect and fallback link", async () => {
    const replace = renderCallback("?code=abc&state=xyz");
    const expected = "nanthai-edge://auth/callback?code=abc&state=xyz";

    await waitFor(() => expect(replace).toHaveBeenCalledWith(expected));
    expect(screen.getByRole("link", { name: /open nanthai edge/i })).toHaveAttribute("href", expected);
  });

  it("preserves OAuth error callback parameters in redirect and fallback link", async () => {
    const replace = renderCallback("?error=access_denied&state=xyz");
    const expected = "nanthai-edge://auth/callback?error=access_denied&state=xyz";

    await waitFor(() => expect(replace).toHaveBeenCalledWith(expected));
    expect(screen.getByRole("link", { name: /open nanthai edge/i })).toHaveAttribute("href", expected);
  });
});
