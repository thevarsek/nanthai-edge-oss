import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProGate } from "./useProGate.hook";

const sharedState = vi.hoisted(() => ({
  proStatus: undefined as undefined | { isPro?: boolean },
}));

vi.mock("@/hooks/useSharedData", () => ({
  useSharedData: () => ({ proStatus: sharedState.proStatus }),
}));

describe("useProGate hook", () => {
  beforeEach(() => {
    sharedState.proStatus = undefined;
  });

  it("defaults to free while loading and reflects shared Pro status", () => {
    const { result, rerender } = renderHook(() => useProGate());

    expect(result.current.isPro).toBe(false);

    sharedState.proStatus = { isPro: true };
    rerender();
    expect(result.current.isPro).toBe(true);

    sharedState.proStatus = { isPro: false };
    rerender();
    expect(result.current.isPro).toBe(false);
  });
});
