import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenRouterCallbackPage } from "./OpenRouterCallbackPage";
import { removeBuildTimeSeoShellElements } from "@/lib/seoShell";

function renderCallback(search: string) {
  removeBuildTimeSeoShellElements();
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

  render(<OpenRouterCallbackPage />);

  return replace;
}

describe("OpenRouterCallbackPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("replaces fallback shell metadata with one noindex callback owner", () => {
    document.head.innerHTML = `
      <title data-seo-shell="true">NanthAI Edge | AI Workspace</title>
      <meta name="robots" content="index, follow" data-seo-shell="true" />
    `;

    renderCallback("?code=abc&state=xyz");

    expect(document.querySelectorAll("title")).toHaveLength(1);
    expect(document.title).toBe("Redirecting to NanthAI Edge");
    expect(document.querySelectorAll('meta[name="robots"]')).toHaveLength(1);
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow, noarchive",
    );
    expect(document.querySelector("[data-seo-shell]")).toBeNull();
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
