import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { FormEvent } from "react";

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

  test("copy controls do not submit parent forms", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());

    render(
      <form onSubmit={onSubmit}>
        <MarkdownRenderer
          content={[
            "```ts",
            "const answer = 42;",
            "```",
            "",
            "| Feature | Status |",
            "|:--|:--|",
            "| Tables | Done |",
          ].join("\n")}
        />
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy table" }));

    expect(onSubmit).not.toHaveBeenCalled();
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

  test("renders compact ideascape markdown without interactive links or heavy code chrome", () => {
    render(
      <MarkdownRenderer
        compact
        streaming
        className="node-markdown"
        content={[
          "# Plan",
          "A [source](https://example.com) and `inline` code.",
          "",
          "```ts",
          "const answer = 42;",
          "```",
          "",
          "| A | B |",
          "|:-:|--:|",
          "| 1 | 2 |",
          "",
          "> quoted",
          "",
          "- first",
          "1. second",
          "",
          "![Diagram](https://example.convex.site/download?storageId=abc&filename=diagram.png)",
        ].join("\n")}
      />,
    );

    expect(screen.getByText("Plan")).toHaveClass("block");
    expect(screen.getByText("source").closest("a")).not.toBeInTheDocument();
    expect(screen.getByText("inline").tagName).toBe("CODE");
    expect(screen.queryByRole("button", { name: /copy code/i })).not.toBeInTheDocument();
    expect(screen.getByText("const answer = 42;").tagName).toBe("CODE");
    expect(screen.getByRole("columnheader", { name: "A" })).toHaveClass("text-center");
    expect(screen.getByRole("cell", { name: "2" })).toHaveClass("text-right");
    expect(screen.getByText("quoted")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Diagram" })).toBeInTheDocument();
    expect(document.querySelector(".markdown-body")).toHaveClass("leading-snug", "will-change-contents", "node-markdown");
  });

  test("links citation references in inline formatted text", () => {
    const onClick = vi.fn();
    render(
      <MarkdownRenderer
        content={"## Evidence [12]\n\nStrong **claim [12]** and _detail [99]_."}
        documentCitationLinks={[{
          ref: 12,
          title: "Source quote",
          onClick,
        }]}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "[12]" })[0]);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByText("detail [99]")).toBeInTheDocument();
  });
});
