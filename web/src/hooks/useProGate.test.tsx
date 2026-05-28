import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ProGateWrapper } from "./useProGate";

let mockIsPro = false;

vi.mock("@/hooks/useProGate.hook", () => ({
  useProGate: () => ({ isPro: mockIsPro }),
}));

vi.mock("@/components/shared/PaywallModal", () => ({
  PaywallModal: ({ feature, onClose }: { feature?: string; onClose: () => void }) => (
    <div role="dialog" aria-label="paywall">
      <p>Paywall for {feature}</p>
      <button type="button" onClick={onClose}>Close</button>
    </div>
  ),
}));

function renderGate(presentation?: "button" | "page") {
  return render(
    <MemoryRouter initialEntries={["/app/settings/jobs"]}>
      <Routes>
        <Route
          path="/app/settings/jobs"
          element={(
            <ProGateWrapper featureId="scheduledJobs" presentation={presentation}>
              <div>Scheduled jobs content</div>
            </ProGateWrapper>
          )}
        />
        <Route path="/app/settings" element={<div>settings page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderButtonGate(featureId?: Parameters<typeof ProGateWrapper>[0]["featureId"], feature?: string) {
  return render(
    <MemoryRouter>
      <ProGateWrapper featureId={featureId} feature={feature}>
        <div>pro content</div>
      </ProGateWrapper>
    </MemoryRouter>,
  );
}

describe("ProGateWrapper", () => {
  it("renders children for Pro users", () => {
    mockIsPro = true;

    renderGate("page");

    expect(screen.getByText("Scheduled jobs content")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /get nanthai pro/i })).not.toBeInTheDocument();
  });

  it("renders a full locked route surface for direct Pro routes", () => {
    mockIsPro = false;

    renderGate("page");

    expect(screen.queryByText("Scheduled jobs content")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /unlock scheduled jobs/i })).toBeInTheDocument();
    expect(screen.getByText(/automate recurring ai tasks/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /get nanthai pro/i })).toBeInTheDocument();
  });

  it("keeps compact gates available for settings rows", () => {
    mockIsPro = false;

    renderGate("button");

    expect(screen.getByRole("button", { name: /upgrade to pro.*scheduled jobs/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /upgrade to pro.*scheduled jobs/i }));
    expect(screen.getByRole("dialog", { name: /paywall/i })).toHaveTextContent("Scheduled Jobs");
  });

  it("lets locked route users dismiss back to settings", () => {
    mockIsPro = false;

    renderGate("page");

    fireEvent.click(screen.getAllByRole("button", { name: /back to settings/i })[1]);
    expect(screen.getByText("settings page")).toBeInTheDocument();
  });

  it("resolves feature-specific compact gate labels and generic fallback copy", () => {
    mockIsPro = false;

    const cases: Array<[Parameters<typeof ProGateWrapper>[0]["featureId"], RegExp]> = [
      ["aiPersonas", /personas/i],
      ["aiSkills", /skills/i],
      ["knowledgeBase", /knowledge base/i],
      ["memory", /memory/i],
      ["integrations", /integrations/i],
    ];

    for (const [featureId, label] of cases) {
      const { unmount } = renderButtonGate(featureId);
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
      unmount();
    }

    renderButtonGate(undefined, "Custom feature");
    expect(screen.getByRole("button", { name: /custom feature/i })).toBeInTheDocument();
  });
});
