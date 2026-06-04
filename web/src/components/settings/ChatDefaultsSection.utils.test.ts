import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { isOwnedVoicePreview, useOptimistic } from "./ChatDefaultsSection.utils";

describe("useOptimistic", () => {
  it("does not pin a pending edit when setting the current server value", async () => {
    const { result, rerender } = renderHook(
      ({ serverValue }: { serverValue: string }) => useOptimistic(serverValue),
      { initialProps: { serverValue: "dark" } },
    );

    act(() => result.current[1]("dark"));
    rerender({ serverValue: "light" });

    await waitFor(() => {
      expect(result.current[0]).toBe("light");
    });
  });
});

describe("isOwnedVoicePreview", () => {
  it("accepts only the current request and current audio element", () => {
    const currentAudio = {} as HTMLAudioElement;
    const staleAudio = {} as HTMLAudioElement;

    expect(isOwnedVoicePreview(2, 2, currentAudio, currentAudio)).toBe(true);
    expect(isOwnedVoicePreview(1, 2, currentAudio, currentAudio)).toBe(false);
    expect(isOwnedVoicePreview(2, 2, staleAudio, currentAudio)).toBe(false);
    expect(isOwnedVoicePreview(2, 2, currentAudio, null)).toBe(false);
  });
});
