import { describe, expect, test } from "vitest";
import {
  sliceStreamingText,
  streamingCharacterLength,
} from "./useStreaming";

describe("useStreaming text slicing", () => {
  test("counts and slices without splitting surrogate pairs", () => {
    const text = "A😀B";

    expect(streamingCharacterLength(text)).toBe(3);
    expect(sliceStreamingText(text, 2)).toBe("A😀");
    expect(sliceStreamingText(text, 2)).not.toContain("\uFFFD");
  });
});
