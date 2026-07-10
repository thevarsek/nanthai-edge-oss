import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { splitTextByMatches, useChatSearch, type SearchMatch } from "./useChatSearch";

describe("splitTextByMatches", () => {
  it("does not duplicate text when matches overlap", () => {
    const matches: SearchMatch[] = [
      { messageId: "msg_1" as never, startOffset: 0, globalIndex: 0 },
      { messageId: "msg_1" as never, startOffset: 1, globalIndex: 1 },
    ];

    const segments = splitTextByMatches("aaaa", matches, 2);

    expect(segments.map((segment) => segment.text).join("")).toBe("aaaa");
    expect(segments).toEqual([
      { text: "aa", isMatch: true, globalIndex: 0 },
      { text: "aa", isMatch: false },
    ]);
  });
});

describe("useChatSearch", () => {
  it("only reports non-overlapping matches that can be highlighted", () => {
    const messages = [
      { _id: "msg_1" as never, role: "assistant", content: "aaaa" },
    ];
    const { result } = renderHook(() => useChatSearch(messages));

    act(() => {
      result.current.setQuery("aa");
    });

    expect(result.current.matches.map((match) => match.startOffset)).toEqual([0, 2]);
    const segments = splitTextByMatches("aaaa", result.current.matches, 2);
    expect(segments.filter((segment) => segment.isMatch).map((segment) => segment.globalIndex)).toEqual(
      result.current.matches.map((match) => match.globalIndex),
    );
  });

  it("clamps the focused result when the match list shrinks", () => {
    const initialMessages = [
      { _id: "msg_1" as never, role: "assistant", content: "alpha" },
      { _id: "msg_2" as never, role: "assistant", content: "alpha" },
      { _id: "msg_3" as never, role: "assistant", content: "alpha" },
    ];
    const { result, rerender } = renderHook(
      ({ messages }) => useChatSearch(messages),
      { initialProps: { messages: initialMessages } },
    );

    act(() => {
      result.current.setQuery("alpha");
    });
    act(() => {
      result.current.next();
      result.current.next();
    });

    expect(result.current.currentIndex).toBe(2);

    rerender({ messages: initialMessages.slice(0, 1) });

    expect(result.current.currentIndex).toBe(0);
    expect(result.current.currentMessageId).toBe("msg_1");
  });

  it("searches the same friendly failed-assistant content that is rendered", () => {
    const messages = [{
      _id: "msg_1" as never,
      role: "assistant",
      status: "failed",
      content: "Error: {\"code\":\"INTERNAL_ERROR\",\"message\":\"Provider unavailable\"}",
    }];
    const { result } = renderHook(() => useChatSearch(messages));

    act(() => result.current.setQuery("provider"));
    expect(result.current.matches).toHaveLength(1);
    expect(result.current.matches[0]?.startOffset).toBe(0);

    act(() => result.current.setQuery("internal_error"));
    expect(result.current.matches).toHaveLength(0);
  });
});
