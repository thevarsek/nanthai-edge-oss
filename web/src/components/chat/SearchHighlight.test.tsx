import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { SearchMatch } from "@/hooks/useChatSearch";
import { SearchHighlight } from "./SearchHighlight";

const searchContext = vi.hoisted(() => ({
  query: "",
  queryLength: 0,
  matches: [] as SearchMatch[],
  focusedGlobalIndex: -1,
}));

vi.mock("./ChatSearchContext", () => ({
  useChatSearchContext: () => searchContext,
}));

describe("SearchHighlight", () => {
  it("renders plain text when search is closed or the message has no matches", () => {
    searchContext.query = "";
    searchContext.queryLength = 0;
    searchContext.matches = [];
    const { rerender } = render(<SearchHighlight messageId={"msg_1" as Id<"messages">} text="alpha beta" />);

    expect(screen.getByText("alpha beta")).toBeInTheDocument();
    expect(document.querySelector("mark")).not.toBeInTheDocument();

    searchContext.query = "beta";
    searchContext.queryLength = 4;
    searchContext.matches = [{ messageId: "msg_2" as Id<"messages">, startOffset: 6, globalIndex: 0 }];
    rerender(<SearchHighlight messageId={"msg_1" as Id<"messages">} text="alpha beta" />);

    expect(screen.getByText("alpha beta")).toBeInTheDocument();
    expect(document.querySelector("mark")).not.toBeInTheDocument();
  });

  it("marks focused and unfocused matches for the active message only", () => {
    searchContext.query = "ha";
    searchContext.queryLength = 2;
    searchContext.focusedGlobalIndex = 1;
    searchContext.matches = [
      { messageId: "msg_1" as Id<"messages">, startOffset: 3, globalIndex: 0 },
      { messageId: "msg_1" as Id<"messages">, startOffset: 9, globalIndex: 1 },
    ];

    const { container } = render(<SearchHighlight messageId={"msg_1" as Id<"messages">} text="alphabet haha" />);

    const marks = document.querySelectorAll("mark");
    expect(marks).toHaveLength(2);
    expect(Array.from(marks).map((mark) => mark.textContent)).toEqual(["ha", "ha"]);
    expect(container.textContent).toBe("alphabet haha");
    expect(marks[0]).toHaveAttribute("data-search-match", "0");
    expect(marks[0]).toHaveClass("bg-primary/30");
    expect(marks[1]).toHaveAttribute("data-search-match", "1");
    expect(marks[1]).toHaveClass("bg-primary");
  });
});
