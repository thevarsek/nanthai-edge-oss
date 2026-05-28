import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { Chat, Participant } from "@/hooks/useChat";
import { useMentionSuggestions, useSearchMode, useSubagentOverride } from "./ChatPage.helpers";

const chatId = "chat_1" as Id<"chats">;
type TestChatOverride = Omit<Partial<Chat>, "subagentOverride"> & {
  subagentOverride?: "inherit" | "enabled" | "disabled" | null;
};

function chat(overrides: TestChatOverride = {}): Chat {
  return {
    _id: chatId,
    _creationTime: 1,
    title: "Chat",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as Chat;
}

describe("ChatPage helper hooks", () => {
  it("builds mention suggestions from persona and bare-model participants", () => {
    const participants: Participant[] = [
      {
        modelId: "openai/gpt-5.2",
        personaId: "persona_1" as Id<"personas">,
        personaName: "Planner",
        personaEmoji: "P",
      },
      { modelId: "anthropic/claude-sonnet-4" },
    ];

    const { result } = renderHook(() => useMentionSuggestions(participants));

    expect(result.current).toEqual([
      expect.objectContaining({
        displayName: "Planner",
        subtitle: "gpt-5.2",
        isPersona: true,
        avatarEmoji: "P",
      }),
      expect.objectContaining({
        displayName: "claude-sonnet-4",
        subtitle: "anthropic",
        isPersona: false,
      }),
    ]);
  });

  it("resolves search mode precedence and writes Convex override payloads", async () => {
    const updateChat = vi.fn(async () => null);
    type SearchModeProps = { chat: Chat | null; defaultsOn: boolean };
    const { result, rerender } = renderHook((props: SearchModeProps) =>
      useSearchMode({
        chat: props.chat,
        chatId,
        updateChat,
        webSearchEnabledByDefault: props.defaultsOn,
        defaultSearchMode: "paper",
        defaultSearchComplexity: 3,
      }),
      {
        initialProps: {
          chat: chat({ searchModeOverride: "web", searchComplexityOverride: 2 }),
          defaultsOn: false,
        } as SearchModeProps,
      },
    );

    expect(result.current.searchMode).toEqual({ mode: "web", complexity: 2 });
    expect(result.current.globeColor).toBe("blue");

    await act(async () => result.current.toggleSearch());
    expect(updateChat).toHaveBeenLastCalledWith({
      chatId,
      webSearchOverride: false,
      searchModeOverride: null,
      searchComplexityOverride: null,
    });

    rerender({ chat: chat({ webSearchOverride: false }), defaultsOn: true });
    expect(result.current.searchMode).toEqual({ mode: "none", complexity: 1 });
    expect(result.current.globeColor).toBe("muted");

    await act(async () => result.current.toggleSearch());
    expect(updateChat).toHaveBeenLastCalledWith({
      chatId,
      webSearchOverride: true,
      searchModeOverride: "paper",
      searchComplexityOverride: 3,
    });

    rerender({ chat: chat({ webSearchOverride: true }), defaultsOn: false });
    expect(result.current.searchMode).toEqual({ mode: "paper", complexity: 3 });
    expect(result.current.globeColor).toBe("orange");

    rerender({ chat: null, defaultsOn: true });
    expect(result.current.searchMode).toEqual({ mode: "paper", complexity: 3 });

    await act(async () => result.current.setSearchMode({ mode: "basic", complexity: 1 }));
    expect(updateChat).toHaveBeenLastCalledWith({
      chatId,
      webSearchOverride: true,
      searchModeOverride: "basic",
      searchComplexityOverride: 1,
    });

    await act(async () => result.current.setSearchMode({ mode: "none", complexity: 1 }));
    expect(updateChat).toHaveBeenLastCalledWith({
      chatId,
      webSearchOverride: false,
      searchModeOverride: null,
      searchComplexityOverride: null,
    });
  });

  it("keeps search and subagent writes inert until a chat id is available", async () => {
    const updateChat = vi.fn(async () => null);
    const search = renderHook(() => useSearchMode({
      chat: null,
      chatId: undefined,
      updateChat,
      webSearchEnabledByDefault: false,
    })).result;
    const subagents = renderHook(() => useSubagentOverride({
      chat: null,
      participantCount: 1,
      isPro: true,
      subagentsEnabledByDefault: true,
      chatId: undefined,
      updateChat,
    })).result;

    await act(async () => {
      await search.current.toggleSearch();
      await search.current.setSearchMode({ mode: "web", complexity: 2 });
      await subagents.current.handleSubagentOverrideChange("enabled");
    });

    expect(updateChat).not.toHaveBeenCalled();
  });

  it("resolves subagent availability from pro status, participant count, defaults, and chat overrides", async () => {
    const updateChat = vi.fn(async () => null);
    type SubagentProps = {
      override?: "inherit" | "enabled" | "disabled";
      count: number;
      isPro: boolean;
      defaultOn: boolean;
    };
    const { result, rerender } = renderHook((props: SubagentProps) => useSubagentOverride({
      chat: props.override ? chat({ subagentOverride: props.override }) : chat(),
      participantCount: props.count,
      isPro: props.isPro,
      subagentsEnabledByDefault: props.defaultOn,
      chatId,
      updateChat,
    }), {
      initialProps: {
        override: "inherit",
        count: 1,
        isPro: true,
        defaultOn: true,
      } as SubagentProps,
    });

    expect(result.current.effectiveSubagentsEnabled).toBe(true);

    rerender({ override: "enabled", count: 1, isPro: true, defaultOn: false });
    expect(result.current.effectiveSubagentsEnabled).toBe(true);

    rerender({ override: "disabled", count: 1, isPro: true, defaultOn: true });
    expect(result.current.effectiveSubagentsEnabled).toBe(false);

    rerender({ override: "enabled", count: 2, isPro: true, defaultOn: true });
    expect(result.current.effectiveSubagentsEnabled).toBe(false);

    rerender({ override: "enabled", count: 1, isPro: false, defaultOn: true });
    expect(result.current.effectiveSubagentsEnabled).toBe(false);

    await act(async () => result.current.handleSubagentOverrideChange("inherit"));
    expect(updateChat).toHaveBeenLastCalledWith({ chatId, subagentOverride: null });

    await act(async () => result.current.handleSubagentOverrideChange("enabled"));
    expect(updateChat).toHaveBeenLastCalledWith({ chatId, subagentOverride: "enabled" });
  });
});
