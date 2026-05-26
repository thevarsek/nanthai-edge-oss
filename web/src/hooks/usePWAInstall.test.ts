import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePWAInstall } from "./usePWAInstall";

describe("usePWAInstall", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: undefined,
    });
  });

  it("does not crash when matchMedia is unavailable", () => {
    const { result } = renderHook(() => usePWAInstall());

    expect(result.current.isInstalled).toBe(false);
  });

  it("does not crash when sessionStorage throws", () => {
    vi.spyOn(window.sessionStorage.__proto__, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    const { result } = renderHook(() => usePWAInstall());

    expect(result.current.showBanner).toBe(false);
  });
});
