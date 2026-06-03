import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaywallModal } from "./PaywallModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => values?.var1 ? `${key}:${values.var1}` : key,
  }),
}));

vi.mock("@convex/_generated/api", () => ({
  api: { stripe: { actions: { createCheckoutSession: "createCheckoutSession" } } },
}));

const createCheckoutSession = vi.fn();
const originalLocation = window.location;

vi.mock("convex/react", () => ({
  useAction: () => createCheckoutSession,
}));

describe("PaywallModal", () => {
  afterEach(() => {
    vi.clearAllMocks();
    document.body.style.overflow = "";
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("locks background scrolling while mounted and restores the previous value", () => {
    document.body.style.overflow = "clip";

    const { unmount } = render(<PaywallModal feature="Search" onClose={() => {}} />);

    expect(document.body.style.overflow).toBe("hidden");

    unmount();

    expect(document.body.style.overflow).toBe("clip");
  });

  it("shows a generic checkout error instead of raw exception text", async () => {
    createCheckoutSession.mockRejectedValueOnce(new Error("stripe secret exploded"));

    render(<PaywallModal feature="Search" onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "get_nanthai_pro" }));

    await waitFor(() => {
      expect(screen.getByText("checkout_failed_try_again")).toBeInTheDocument();
    });
    expect(screen.queryByText(/stripe secret exploded/i)).not.toBeInTheDocument();
  });

  it("focuses and traps keyboard navigation inside the dialog", () => {
    render(<PaywallModal feature="Search" onClose={() => {}} />);

    const closeButton = screen.getByRole("button", { name: "Close paywall" });
    const restoreButton = screen.getByRole("button", { name: "restore_purchase" });

    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab", shiftKey: true });
    expect(restoreButton).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });
    expect(closeButton).toHaveFocus();
  });

  it("closes with Escape", () => {
    const onClose = vi.fn();
    render(<PaywallModal feature="Search" onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not redirect after checkout launch is cancelled by closing", async () => {
    const checkout = deferred<{ url: string }>();
    createCheckoutSession.mockReturnValueOnce(checkout.promise);
    const location = {
      ...originalLocation,
      href: "http://localhost/app",
      origin: "http://localhost",
    };
    Object.defineProperty(window, "location", {
      configurable: true,
      value: location,
    });
    const onClose = vi.fn();
    render(<PaywallModal feature="Search" onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "get_nanthai_pro" }));
    fireEvent.click(screen.getByRole("button", { name: "Close paywall" }));

    await act(async () => {
      checkout.resolve({ url: "https://checkout.example/session" });
      await checkout.promise;
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe("http://localhost/app");
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
