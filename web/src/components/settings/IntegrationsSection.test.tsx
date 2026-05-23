import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IntegrationDefaultsCard } from "./IntegrationsSection";

let prefs: unknown;
const setIntegrationDefault = vi.fn();
const removeIntegrationDefault = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: () => prefs,
  useMutation: (() => {
    let index = 0;
    return () => (index++ % 2 === 0 ? setIntegrationDefault : removeIntegrationDefault);
  })(),
}));

vi.mock("@/components/shared/Toast.context", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe("IntegrationDefaultsCard", () => {
  it("does not write defaults while preferences are still loading", () => {
    prefs = undefined;

    render(<IntegrationDefaultsCard />);

    const gmailButton = screen.getByRole("button", { name: /gmail/i });
    expect(gmailButton).toBeDisabled();
    fireEvent.click(gmailButton);

    expect(setIntegrationDefault).not.toHaveBeenCalled();
    expect(removeIntegrationDefault).not.toHaveBeenCalled();
  });

  it("cycles from a loaded disabled default to inherited", async () => {
    prefs = { integrationDefaults: [{ integrationId: "gmail", enabled: false }] };

    render(<IntegrationDefaultsCard />);
    fireEvent.click(screen.getByRole("button", { name: /gmail/i }));

    await waitFor(() => {
      expect(removeIntegrationDefault).toHaveBeenCalledWith({ integrationId: "gmail" });
    });
  });
});
