import { fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicPageScroll } from "./PublicPageScroll";

function Journey() {
  const navigate = useNavigate();
  return <><PublicPageScroll /><Link to="/workflows">Workflows</Link><Link to="/local-runtime#mac-setup">Setup</Link><button onClick={() => navigate(-1)}>Back</button></>;
}
afterEach(() => vi.restoreAllMocks());

describe("public page navigation", () => {
  it("starts an ordinary destination at the top", () => {
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    render(<MemoryRouter><Journey /></MemoryRouter>);
    expect(scroll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("link", { name: "Workflows" }));
    expect(scroll).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "instant" });
    scroll.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(scroll).not.toHaveBeenCalled();
  });
  it("leaves hash navigation to the destination", () => {
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    render(<MemoryRouter><Journey /></MemoryRouter>);
    fireEvent.click(screen.getByRole("link", { name: "Setup" }));
    expect(scroll).not.toHaveBeenCalled();
  });
});
