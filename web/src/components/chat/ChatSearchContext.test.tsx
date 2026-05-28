import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Id } from "@convex/_generated/dataModel";

import { ChatSearchContext, useChatSearchContext } from "./ChatSearchContext";

function SearchProbe() {
  const search = useChatSearchContext();

  return (
    <output aria-label="search-state">
      {search.query}:{search.queryLength}:{search.focusedGlobalIndex}:{search.matches.length}
    </output>
  );
}

describe("ChatSearchContext", () => {
  it("provides empty search state when no provider is mounted", () => {
    render(<SearchProbe />);

    expect(screen.getByLabelText("search-state")).toHaveTextContent(":0:-1:0");
  });

  it("returns the provider search state", () => {
    render(
      <ChatSearchContext.Provider
        value={{
          query: "convex",
          queryLength: 6,
          focusedGlobalIndex: 2,
          matches: [
            {
              messageId: "message_1" as Id<"messages">,
              startOffset: 0,
              globalIndex: 2,
            },
          ],
        }}
      >
        <SearchProbe />
      </ChatSearchContext.Provider>,
    );

    expect(screen.getByLabelText("search-state")).toHaveTextContent("convex:6:2:1");
  });
});
