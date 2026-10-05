import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AIConnectionsSection } from "./AIConnectionsSection";

const state = vi.hoisted(() => ({ connected: false, status: "online", balance: 13.17 }));
vi.mock("convex/react", () => ({ useQuery: () => ({ status: state.status, deviceName: "QA Mac" }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/useSharedData", () => ({
  useOpenRouterStatus: () => state.connected,
  useCreditBalance: () => ({ balance: state.balance, loading: false }),
  formatUsd: (value: number) => `$${value.toFixed(2)}`,
}));

describe("AIConnectionsSection", () => {
  it("shows an online local computer when OpenRouter is disconnected, and keeps both detail routes", () => {
    state.connected = false;
    const onOpenRouter = vi.fn();
    const { rerender } = render(<MemoryRouter><AIConnectionsSection onOpenRouter={onOpenRouter} /></MemoryRouter>);
    expect(screen.getByText("not_connected")).toBeVisible();
    expect(screen.getByText("ai_connection_online · QA Mac")).toBeVisible();
    expect(screen.getByRole("link", { name: /local_runtime_title/ })).toHaveAttribute("href", "/app/settings/local-runtime");
    fireEvent.click(screen.getByRole("button", { name: /OpenRouter/ }));
    expect(onOpenRouter).toHaveBeenCalledOnce();
    state.connected = true;
    state.status = "offline";
    rerender(<MemoryRouter><AIConnectionsSection onOpenRouter={onOpenRouter} /></MemoryRouter>);
    expect(screen.getByText("$13.17")).toBeVisible();
    expect(screen.getByText("ai_connection_offline · QA Mac")).toBeVisible();
  });
});
