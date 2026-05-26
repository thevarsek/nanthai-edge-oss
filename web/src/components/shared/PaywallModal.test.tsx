import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

vi.mock("convex/react", () => ({
  useAction: () => createCheckoutSession,
}));

describe("PaywallModal", () => {
  afterEach(() => {
    document.body.style.overflow = "";
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
});
