import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ProvidersSection } from "./ProvidersSection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("ProvidersSection", () => {
  it("links the enabled-provider row to the provider settings route", () => {
    render(
      <MemoryRouter>
        <ProvidersSection />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /enabled_providers/i })).toHaveAttribute("href", "/app/settings/providers");
  });
});
