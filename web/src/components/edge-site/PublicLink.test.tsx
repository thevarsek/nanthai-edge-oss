import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import { PublicLink } from "./PublicLink";

afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });
it("localizes public destinations and preserves app paths, queries and hashes", async () => {
  await i18n.changeLanguage("it");
  render(<MemoryRouter>
    <PublicLink to="/features/byok?source=home#details">Feature</PublicLink>
    <PublicLink to={{ pathname: "/workflows", hash: "#example", search: "?source=home" }}>Workflows</PublicLink>
    <PublicLink to="/app?chat=123#message">App</PublicLink>
    <PublicLink to="/sign-in">Sign in</PublicLink>
    <PublicLink to="https://nanthai.tech/app">External app</PublicLink>
  </MemoryRouter>);
  expect(screen.getByRole("link", { name: "Feature" })).toHaveAttribute("href", "/it/features/byok?source=home#details");
  expect(screen.getByRole("link", { name: "Workflows" })).toHaveAttribute("href", "/it/workflows?source=home#example");
  expect(screen.getByRole("link", { name: "App" })).toHaveAttribute("href", "/app?chat=123#message");
  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
  expect(screen.getByRole("link", { name: "External app" })).toHaveAttribute("href", "https://nanthai.tech/app");
});
