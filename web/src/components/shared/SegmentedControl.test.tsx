import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./SegmentedControl";

describe("SegmentedControl", () => {
  it("uses non-submit buttons inside forms", () => {
    const onSubmit = vi.fn((event: React.FormEvent<HTMLFormElement>) => event.preventDefault());
    const onChange = vi.fn();

    render(
      <form onSubmit={onSubmit}>
        <SegmentedControl
          value="default"
          options={[
            { value: "default", label: "Default" },
            { value: "override", label: "Override" },
          ]}
          onChange={onChange}
        />
      </form>,
    );

    const override = screen.getByRole("radio", { name: "Override" });
    expect(override).toHaveAttribute("type", "button");

    fireEvent.click(override);

    expect(onChange).toHaveBeenCalledWith("override");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("exposes selected segment state to assistive technology", () => {
    render(
      <SegmentedControl
        aria-label="Mode"
        value="default"
        options={[
          { value: "default", label: "Default" },
          { value: "override", label: "Override" },
        ]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("radiogroup", { name: "Mode" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Default" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Override" })).toHaveAttribute("aria-checked", "false");
  });
});
