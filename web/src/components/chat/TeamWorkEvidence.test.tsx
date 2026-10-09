import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { TeamWorkEvidence } from "./TeamWorkEvidence";

const query = vi.hoisted(() => ({ message: undefined as { content: string } | null | undefined }));
vi.mock("convex/react", () => ({ useQuery: () => query.message }));

function EvidenceFixture() {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>View result</button>
    <button>Background action</button>
    {open && <TeamWorkEvidence messageId={"reply" as Id<"messages">} onClose={() => setOpen(false)} />}
  </>;
}

describe("TeamWorkEvidence", () => {
  beforeEach(() => { query.message = undefined; });

  it("keeps keyboard focus inside while evidence loads and restores it on Escape", async () => {
    const user = userEvent.setup();
    render(<EvidenceFixture />);
    const trigger = screen.getByRole("button", { name: "View result" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Published evidence" })).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Loading evidence…")).toBeInTheDocument();
    const close = screen.getByRole("button", { name: "Close evidence" });
    expect(close).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(close).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("includes loaded result links in the focus cycle and restores focus when closed", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<EvidenceFixture />);
    const trigger = screen.getByRole("button", { name: "View result" });
    await user.click(trigger);
    query.message = { content: "[Source](https://example.com/report)\n\n- [x] Verified" };
    rerender(<EvidenceFixture />);
    const close = screen.getByRole("button", { name: "Close evidence" });
    const link = screen.getByRole("link", { name: "Source" });
    await user.tab({ shift: true });
    expect(link).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab();
    expect(link).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.click(close);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("keeps unavailable evidence dismissible by keyboard", async () => {
    query.message = null;
    const user = userEvent.setup();
    render(<EvidenceFixture />);
    await user.click(screen.getByRole("button", { name: "View result" }));
    expect(screen.getByText("This evidence is unavailable.")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
