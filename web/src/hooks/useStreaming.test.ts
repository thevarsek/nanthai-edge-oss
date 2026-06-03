import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import {
  sliceStreamingText,
  streamingCharacterLength,
  useStreaming,
} from "./useStreaming";

describe("useStreaming text slicing", () => {
  test("counts and slices without splitting surrogate pairs", () => {
    const text = "A😀B";

    expect(streamingCharacterLength(text)).toBe(3);
    expect(sliceStreamingText(text, 2)).toBe("A😀");
    expect(sliceStreamingText(text, 2)).not.toContain("\uFFFD");
  });

  test("reveals first non-empty chunk immediately after an empty streaming start", async () => {
    const { result, rerender } = renderHook(
      ({ content }) => useStreaming(content, true),
      { initialProps: { content: "" } },
    );

    expect(result.current.displayed).toBe("");

    rerender({ content: "first chunk" });

    await waitFor(() => {
      expect(result.current.displayed).toBe("first chunk");
    });
  });
});
