import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { MarkdownRenderer } from "./MarkdownRenderer";

describe("MarkdownRenderer", () => {
  test("renders GFM task lists as checkboxes", () => {
    render(<MarkdownRenderer content={"- [x] Done\n- [ ] Todo"} />);

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
  });

  test("renders callout blockquotes without the marker", () => {
    render(<MarkdownRenderer content={"> [!WARNING]\n> Tables can break on mobile."} />);

    expect(screen.getByText("Warning")).toBeInTheDocument();
    expect(screen.getByText("Tables can break on mobile.")).toBeInTheDocument();
    expect(screen.queryByText(/\[!WARNING\]/)).not.toBeInTheDocument();
  });

  test("keeps table alignment from the divider row", () => {
    render(
      <MarkdownRenderer
        content={[
          "| Feature | Status | Complexity | Notes |",
          "|:--|:--:|--:|:--|",
          "| Tables | Done | 3 | Alignment may vary |",
        ].join("\n")}
      />,
    );

    expect(screen.getByRole("columnheader", { name: "Feature" })).toHaveClass("text-left");
    expect(screen.getByRole("columnheader", { name: "Status" })).toHaveClass("text-center");
    expect(screen.getByRole("columnheader", { name: "Complexity" })).toHaveClass("text-right");
    expect(screen.getByRole("cell", { name: "3" })).toHaveClass("text-right");
  });

  test("copies only the clicked table markdown", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <MarkdownRenderer
        content={[
          "Before table.",
          "",
          "| Feature | Status |",
          "|:--|:--|",
          "| Tables | Done |",
          "",
          "After table.",
        ].join("\n")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy table" }));

    expect(writeText).toHaveBeenCalledWith(
      ["| Feature | Status |", "|:--|:--|", "| Tables | Done |"].join("\n"),
    );
  });

  test("copies GFM table markdown without edge pipes", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <MarkdownRenderer
        content={[
          "Before table.",
          "",
          "Feature | Status",
          "--- | ---",
          "Tables | Done",
          "",
          "After table.",
        ].join("\n")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy table" }));

    expect(writeText).toHaveBeenCalledWith(
      ["Feature | Status", "--- | ---", "Tables | Done"].join("\n"),
    );
  });

  test("renders definition list syntax as a structured table", () => {
    render(<MarkdownRenderer content={"BYOK\n: Bring your own key.\n\nAgent\n: A system that can plan."} />);

    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Term" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Definition" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "BYOK" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "Bring your own key." })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "Agent" })).toBeInTheDocument();
  });

  test("copies rendered definition-list table markdown", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<MarkdownRenderer content={"BYOK\n: Bring your own key."} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy table" }));

    expect(writeText).toHaveBeenCalledWith(
      ["| Term | Definition |", "|:--|:--|", "| BYOK | Bring your own key. |"].join("\n"),
    );
  });

  test("shows alt text when a Convex markdown image fails", () => {
    render(<MarkdownRenderer content={"![Example placeholder image](https://example.convex.site/download?storageId=abc&filename=image.png)"} />);

    fireEvent.error(screen.getByRole("img", { name: "Example placeholder image" }));

    expect(screen.getByText("Failed to load image: Example placeholder image")).toBeInTheDocument();
  });

  test("does not render external markdown images", () => {
    render(<MarkdownRenderer content={"![External tracker](https://example.com/tracker.png)"} />);

    expect(screen.queryByRole("img", { name: "External tracker" })).not.toBeInTheDocument();
    expect(screen.getByText("External tracker")).toBeInTheDocument();
  });
});
