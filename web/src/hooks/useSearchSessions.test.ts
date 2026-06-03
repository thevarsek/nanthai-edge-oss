import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { isSessionActive, phaseLabelKey, useSearchSessions, type SearchSessionStatus } from "./useSearchSessions";

const queryState = vi.hoisted(() => ({
  result: undefined as unknown,
  calls: [] as unknown[],
}));

vi.mock("convex/react", () => ({
  useQuery: (query: unknown, args: unknown) => {
    queryState.calls.push({ query, args });
    return queryState.result;
  },
}));

describe("search session helpers", () => {
  beforeEach(() => {
    queryState.result = undefined;
    queryState.calls = [];
  });

  it("classifies active and terminal phases with stable translation keys", () => {
    const expected: Record<SearchSessionStatus, string> = {
      planning: "search_phase_planning",
      searching: "search_phase_searching",
      analyzing: "search_phase_analyzing",
      deepening: "search_phase_deepening",
      synthesizing: "search_phase_synthesizing",
      writing: "search_phase_writing",
      completed: "search_phase_completed",
      failed: "search_phase_failed",
      cancelled: "search_phase_cancelled",
    };

    for (const [status, key] of Object.entries(expected) as Array<[SearchSessionStatus, string]>) {
      expect(phaseLabelKey(status)).toBe(key);
    }
    expect(isSessionActive("planning")).toBe(true);
    expect(isSessionActive("writing")).toBe(true);
    expect(isSessionActive("completed")).toBe(false);
    expect(isSessionActive("failed")).toBe(false);
    expect(isSessionActive("cancelled")).toBe(false);
  });

  it("uses mode-aware writing phase labels", () => {
    expect(phaseLabelKey("writing", "web")).toBe("search_phase_writing");
    expect(phaseLabelKey("writing", "paper")).toBe("search_phase_writing_paper");
  });

  it("builds a lookup map and skips the Convex subscription without a chat id", () => {
    const { result, rerender } = renderHook(({ chatId }: { chatId?: Id<"chats"> }) => useSearchSessions(chatId), {
      initialProps: { chatId: undefined as Id<"chats"> | undefined },
    });

    expect(queryState.calls.at(-1)).toMatchObject({ args: "skip" });
    expect(result.current.sessions).toEqual([]);
    expect(result.current.sessionMap.size).toBe(0);

    queryState.result = [{
      _id: "session_1",
      _creationTime: 1,
      chatId: "chat_1",
      assistantMessageId: "message_1",
      query: "weather",
      mode: "web",
      complexity: 1,
      status: "searching",
      progress: 50,
      currentPhase: "searching",
      phaseOrder: 1,
      startedAt: 1,
    }];
    rerender({ chatId: "chat_1" as Id<"chats"> });

    expect(queryState.calls.at(-1)).toMatchObject({ args: { chatId: "chat_1" } });
    expect(result.current.sessionMap.get("session_1")).toMatchObject({ query: "weather" });
  });
});
