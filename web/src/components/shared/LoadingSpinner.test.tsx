import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LoadingSpinner } from "./LoadingSpinner";

describe("LoadingSpinner", () => {
  it("does not constrain reduced-motion fallback text to the spinner box", () => {
    render(<LoadingSpinner label="Syncing account" />);

    const status = screen.getByRole("status", { name: "Syncing account" });
    const fallback = screen.getByText("Syncing account...");

    expect(status).toHaveClass("motion-reduce:w-auto", "motion-reduce:h-auto");
    expect(fallback).toHaveClass("motion-reduce:whitespace-nowrap");
  });
});
