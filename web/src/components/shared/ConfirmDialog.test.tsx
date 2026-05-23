import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
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
    document.body.style.overflow = "";
  });
});
