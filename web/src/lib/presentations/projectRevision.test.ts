import { describe, expect, it } from "vitest";
import { advanceProjectRevision } from "./projectRevision";

describe("advanceProjectRevision", () => {
  it("never regresses when concurrent responses arrive out of order", () => {
    expect(advanceProjectRevision(14, 13)).toBe(14);
    expect(advanceProjectRevision(13, 14)).toBe(14);
  });
});
