import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RuntimeDownloadLink } from "./RuntimeDownloadLink";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
beforeEach(() => vi.stubEnv("VITE_NANTHAI_RUNTIME_HOST_DOWNLOAD_URL", ""));
afterEach(() => vi.unstubAllEnvs());
function page(fallbackToSetup = true) { render(<MemoryRouter><RuntimeDownloadLink fallbackToSetup={fallbackToSetup} /></MemoryRouter>); }

it("renders outside authentication and preserves the signed release URL", () => {
  const url = "https://runtime-test.convex.site/api/storage/public-dmg?token=abc%2Bdef&expires=2000000000";
  vi.stubEnv("VITE_NANTHAI_RUNTIME_HOST_DOWNLOAD_URL", url);
  page();
  expect(screen.getByRole("link", { name: "local_work_download" })).toHaveAttribute("href", url);
  expect(screen.queryByRole("link", { name: "local_work_start" })).not.toBeInTheDocument();
});

it.each(["", undefined, "javascript:alert(1)"])("uses the truthful setup label when no usable download URL is available: %s", url => {
  vi.stubEnv("VITE_NANTHAI_RUNTIME_HOST_DOWNLOAD_URL", url);
  page();
  expect(screen.queryByRole("link", { name: "local_work_download" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "local_work_start" })).toHaveAttribute("href", "/app/settings/local-runtime");
});

it("omits the optional hero download when release metadata is absent", () => {
  vi.stubEnv("VITE_NANTHAI_RUNTIME_HOST_DOWNLOAD_URL", undefined);
  page(false);
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
