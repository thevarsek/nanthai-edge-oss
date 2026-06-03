import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  afterEach(() => {
    document.body.style.overflow = "";
  });

  it("restores the previous body overflow value when closed", () => {
    document.body.style.overflow = "clip";

    const { unmount } = render(
      <ConfirmDialog
        isOpen
        onClose={() => {}}
        onConfirm={() => {}}
        title="Delete item"
        description="This cannot be undone."
      />,
    );

    expect(document.body.style.overflow).toBe("hidden");

    unmount();

    expect(document.body.style.overflow).toBe("clip");
  });

  it("keeps body scrolling locked until every overlapping dialog closes", () => {
    document.body.style.overflow = "clip";

    const first = render(
      <ConfirmDialog
        isOpen
        onClose={() => {}}
        onConfirm={() => {}}
        title="Delete item"
        description="This cannot be undone."
      />,
    );
    const second = render(
      <ConfirmDialog
        isOpen
        onClose={() => {}}
        onConfirm={() => {}}
        title="Delete item again"
        description="This still cannot be undone."
      />,
    );

    expect(document.body.style.overflow).toBe("hidden");

    first.unmount();

    expect(document.body.style.overflow).toBe("hidden");

    second.unmount();

    expect(document.body.style.overflow).toBe("clip");
  });

  it("closes only the topmost overlapping dialog on Escape", () => {
    const firstClose = vi.fn();
    const secondClose = vi.fn();
    const first = render(
      <ConfirmDialog
        isOpen
        onClose={firstClose}
        onConfirm={() => {}}
        title="Delete item"
        description="This cannot be undone."
      />,
    );
    const second = render(
      <ConfirmDialog
        isOpen
        onClose={secondClose}
        onConfirm={() => {}}
        title="Delete item again"
        description="This still cannot be undone."
      />,
    );

    fireEvent.keyDown(window, { key: "Escape" });

    expect(firstClose).not.toHaveBeenCalled();
    expect(secondClose).toHaveBeenCalledTimes(1);

    first.unmount();
    second.unmount();
  });

  it("keeps tab focus inside the dialog", () => {
    render(
      <ConfirmDialog
        isOpen
        onClose={() => {}}
        onConfirm={() => {}}
        title="Delete item"
        description="This cannot be undone."
      />,
    );

    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Delete" });

    expect(cancel).toHaveFocus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(cancel).toHaveFocus();
  });

  it("wires the description and error into accessible dialog semantics", () => {
    render(
      <ConfirmDialog
        isOpen
        onClose={() => {}}
        onConfirm={() => {}}
        title="Delete item"
        description="This cannot be undone."
        errorMessage="Deletion failed."
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Delete item" });

    expect(dialog).toHaveAccessibleDescription("This cannot be undone. Deletion failed.");
    expect(screen.getByRole("alert")).toHaveTextContent("Deletion failed.");
  });
});
