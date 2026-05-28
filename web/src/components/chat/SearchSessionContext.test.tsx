import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";

import { SearchSessionContext, useSearchSessionContext } from "./SearchSessionContext";
import type { SearchSession } from "@/hooks/useSearchSessions";

function SessionProbe() {
  const sessions = useSearchSessionContext();

  return (
    <div>
      <output aria-label="session-count">{sessions.sessionMap.size}</output>
      <button type="button" onClick={() => sessions.onCancel("session_1")}>
        Cancel
      </button>
      <button type="button" onClick={() => sessions.onRegenerate("session_1")}>
        Regenerate
      </button>
    </div>
  );
}

describe("SearchSessionContext", () => {
  it("provides no-op handlers and an empty session map by default", async () => {
    render(<SessionProbe />);

    expect(screen.getByLabelText("session-count")).toHaveTextContent("0");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Regenerate" }));
  });

  it("uses provider handlers for cancel and regenerate actions", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onRegenerate = vi.fn();

    render(
      <SearchSessionContext.Provider
        value={{
          sessionMap: new Map<string, SearchSession>([
            [
              "session_1",
              {
                _id: "session_1" as Id<"searchSessions">,
                _creationTime: 1,
                chatId: "chat_1" as Id<"chats">,
                assistantMessageId: "message_1" as Id<"messages">,
                query: "Search session",
                mode: "web",
                complexity: 1,
                status: "completed",
                progress: 100,
                currentPhase: "completed",
                phaseOrder: 6,
                startedAt: 1,
                completedAt: 2,
              },
            ],
          ]),
          onCancel,
          onRegenerate,
        }}
      >
        <SessionProbe />
      </SearchSessionContext.Provider>,
    );

    expect(screen.getByLabelText("session-count")).toHaveTextContent("1");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Regenerate" }));

    expect(onCancel).toHaveBeenCalledWith("session_1");
    expect(onRegenerate).toHaveBeenCalledWith("session_1");
  });
});
