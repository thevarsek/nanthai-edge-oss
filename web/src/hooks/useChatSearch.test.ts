import { describe, expect, it } from "vitest";
import { splitTextByMatches, type SearchMatch } from "./useChatSearch";

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
