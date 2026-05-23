import { describe, expect, it } from "vitest";
import { nextWalkthroughSelection } from "./MainWalkthrough.utils";

describe("MainWalkthrough", () => {
  it("keeps rapid next clicks within the available card range", () => {
    const total = 6;

    const firstQueuedUpdate = nextWalkthroughSelection(4, total);
    const secondQueuedUpdate = nextWalkthroughSelection(firstQueuedUpdate, total);

    expect(firstQueuedUpdate).toBe(5);
    expect(secondQueuedUpdate).toBe(5);
  });
});
