import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useOnlineStatus } from "./useOnlineStatus";

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value,
  });
}

describe("useOnlineStatus", () => {
  afterEach(() => {
    setNavigatorOnline(true);
  });

  it("starts from navigator state and follows online/offline browser events", () => {
    setNavigatorOnline(false);
    const { result, unmount } = renderHook(() => useOnlineStatus());

    expect(result.current).toBe(false);

    act(() => window.dispatchEvent(new Event("online")));
    expect(result.current).toBe(true);

    act(() => window.dispatchEvent(new Event("offline")));
    expect(result.current).toBe(false);

    unmount();
    act(() => window.dispatchEvent(new Event("online")));
    expect(result.current).toBe(false);
  });
});
