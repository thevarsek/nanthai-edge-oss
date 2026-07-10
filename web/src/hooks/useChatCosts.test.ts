import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { EMPTY_BREAKDOWN, formatCost, hasAncillaryCosts, useChatCosts } from "./useChatCosts";

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

describe("useChatCosts", () => {
  beforeEach(() => {
    queryState.result = undefined;
    queryState.calls = [];
  });

  it("skips subscription until advanced stats and chat id are available", () => {
    const { rerender, result } = renderHook(
      ({ chatId, enabled }: { chatId?: Id<"chats">; enabled: boolean }) => useChatCosts(chatId, enabled),
      { initialProps: { chatId: undefined as Id<"chats"> | undefined, enabled: true } },
    );

    expect(queryState.calls.at(-1)).toMatchObject({ args: "skip" });
    expect(result.current).toEqual({ totalCost: null, messageCosts: {}, breakdown: null });

    rerender({ chatId: "chat_1" as Id<"chats">, enabled: false });
    expect(queryState.calls.at(-1)).toMatchObject({ args: "skip" });
  });

  it("returns live cost summaries and formats ancillary buckets", () => {
    queryState.result = {
      totalCost: 0.12345,
      messageCosts: { msg_1: 0.02 },
      breakdown: { responses: 0.1, memory: 0.01, search: 0, advisors: 0.02, other: 0 },
    };

    const { result } = renderHook(() => useChatCosts("chat_1" as Id<"chats">, true));

    expect(queryState.calls.at(-1)).toMatchObject({ args: { chatId: "chat_1" } });
    expect(result.current.totalCost).toBe(0.12345);
    expect(result.current.messageCosts).toEqual({ msg_1: 0.02 });
    expect(formatCost(0.12345)).toBe("$0.1235");
    expect(hasAncillaryCosts(result.current.breakdown!)).toBe(true);
    expect(hasAncillaryCosts(EMPTY_BREAKDOWN)).toBe(false);
  });
});
