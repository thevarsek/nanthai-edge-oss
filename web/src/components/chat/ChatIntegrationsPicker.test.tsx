import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatIntegrationsPicker } from "./ChatIntegrationsPicker";

const connectedProviders = {
  gmail: true,
  google: true,
  microsoft: false,
  apple: false,
  notion: false,
  cloze: false,
  slack: false,
};

describe("ChatIntegrationsPicker", () => {
  it("labels the close control and exposes integration toggles as switches", () => {
    const onToggle = vi.fn();
    const onClose = vi.fn();

    render(
      <ChatIntegrationsPicker
        enabledIntegrations={new Set()}
        onToggle={onToggle}
        onClose={onClose}
        connectedProviders={connectedProviders}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("switch", { name: /Google Drive/i }));
    expect(onToggle).toHaveBeenCalledWith("drive");
  });

  it("toggles an integration from the full row click target", () => {
    const onToggle = vi.fn();

    render(
      <ChatIntegrationsPicker
        enabledIntegrations={new Set()}
        onToggle={onToggle}
        onClose={vi.fn()}
        connectedProviders={connectedProviders}
      />,
    );

    fireEvent.click(screen.getByText("Google Drive"));

    expect(onToggle).toHaveBeenCalledWith("drive");
  });

  it("disables blocked Google switches", () => {
    render(
      <ChatIntegrationsPicker
        enabledIntegrations={new Set()}
        onToggle={vi.fn()}
        onClose={vi.fn()}
        connectedProviders={connectedProviders}
        googleIntegrationsBlocked
      />,
    );

    expect(screen.getByRole("switch", { name: /Google Drive/i })).toBeDisabled();
    expect(screen.getByRole("switch", { name: /Gmail/i })).toBeDisabled();
  });

  it("does not toggle blocked Gmail", () => {
    const onToggle = vi.fn();
    render(
      <ChatIntegrationsPicker
        enabledIntegrations={new Set()}
        onToggle={onToggle}
        onClose={vi.fn()}
        connectedProviders={connectedProviders}
        googleIntegrationsBlocked
      />,
    );

    fireEvent.click(screen.getAllByText("Gmail")[1]);

    expect(onToggle).not.toHaveBeenCalled();
  });
});
