import { describe, expect, it } from "vitest";

import { localizedPublicDate } from "./localizedPublicDate";

describe("localizedPublicDate", () => {
  it("formats public document dates in the selected language", () => {
    expect(localizedPublicDate("2026-07-13", "en")).toBe("July 13, 2026");
    expect(localizedPublicDate("2026-07-13", "it")).toBe("13 luglio 2026");
  });
});
