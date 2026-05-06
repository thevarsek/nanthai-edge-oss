import { render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { ReactNode } from "react";
import { AutoAudioWatcher } from "./AutoAudioWatcher";
import { AudioPlaybackContext, type AudioPlaybackContextValue } from "./AudioPlaybackContext.hook";
import type { Message } from "@/hooks/useChat";
import type { Id } from "@convex/_generated/dataModel";

function message(overrides: Omit<Partial<Message>, "_id" | "role"> & {
  _id: Id<"messages">;
  role: Message["role"];
}): Message {
  const { _id, role, ...rest } = overrides;
  return {
    _id,
    _creationTime: 1,
    chatId: "chat_1" as Id<"chats">,
    role,
    content: "",
    status: rest.status ?? "completed",
    createdAt: 1,
    ...rest,
  };
}

function renderWatcher(args: {
  messages: Message[];
  isLoading?: boolean;
  play?: AudioPlaybackContextValue["play"];
}) {
  const play = args.play ?? vi.fn(async () => undefined);
  const audio: AudioPlaybackContextValue = {
    state: {
      activeMessageId: null,
      isPlaying: false,
      isLoading: false,
      progress: 0,
      duration: 0,
      currentTime: 0,
      speed: 1,
    },
    play,
    pause: vi.fn(),
    stop: vi.fn(),
    cycleSpeed: vi.fn(),
    seek: vi.fn(),
  };
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AudioPlaybackContext.Provider value={audio}>
      {children}
    </AudioPlaybackContext.Provider>
  );

  return {
    play,
    ...render(<AutoAudioWatcher messages={args.messages} isLoading={args.isLoading} />, { wrapper: Wrapper }),
  };
}

describe("AutoAudioWatcher", () => {
  test("does not autoplay existing generated audio after loading finishes", () => {
    const userAudio = message({
      _id: "u1" as Id<"messages">,
      role: "user",
      audioStorageId: "storage_user" as Id<"_storage">,
    });
    const assistantAudio = message({
      _id: "a1" as Id<"messages">,
      role: "assistant",
      audioStorageId: "storage_assistant" as Id<"_storage">,
    });
    const { play, rerender } = renderWatcher({
      messages: [],
      isLoading: true,
    });

    rerender(<AutoAudioWatcher messages={[userAudio, assistantAudio]} isLoading={false} />);

    expect(play).not.toHaveBeenCalled();
  });

  test("autoplays assistant audio that appears after initial history is seeded", () => {
    const userAudio = message({
      _id: "u1" as Id<"messages">,
      role: "user",
      audioStorageId: "storage_user" as Id<"_storage">,
    });
    const assistantPendingAudio = message({
      _id: "a1" as Id<"messages">,
      role: "assistant",
    });
    const assistantWithAudio = {
      ...assistantPendingAudio,
      audioStorageId: "storage_assistant" as Id<"_storage">,
    };
    const { play, rerender } = renderWatcher({
      messages: [userAudio, assistantPendingAudio],
      isLoading: false,
    });

    rerender(<AutoAudioWatcher messages={[userAudio, assistantWithAudio]} isLoading={false} />);

    expect(play).toHaveBeenCalledWith("a1", "storage_assistant");
  });
});
