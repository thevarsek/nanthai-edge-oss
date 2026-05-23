import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mutationCalls: string[] = [];
const removeToken = vi.fn(async () => {
  mutationCalls.push("removeToken");
});

vi.mock("convex/react", () => ({
  useMutation: () => removeToken,
}));

describe("useWebPush", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mutationCalls.length = 0;
    Object.defineProperty(window, "PushManager", {
      configurable: true,
      value: class PushManager {},
    });
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: { permission: "granted", requestPermission: vi.fn() },
    });
  });

  it("removes the backend token before unsubscribing the browser subscription", async () => {
    const subscription = {
      endpoint: "https://push.example/token",
      unsubscribe: vi.fn(async () => {
        mutationCalls.push("unsubscribe");
        return true;
      }),
    };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistration: vi.fn(async () => ({
          pushManager: {
            getSubscription: vi.fn(async () => subscription),
          },
        })),
      },
    });

    const { useWebPush } = await import("./useWebPush");
    const { result } = renderHook(() => useWebPush());

    await act(async () => {
      await expect(result.current.disable()).resolves.toBe(true);
    });

    expect(mutationCalls).toEqual(["removeToken", "unsubscribe"]);
    expect(removeToken).toHaveBeenCalledWith({ token: "https://push.example/token" });
  });

  it("keeps the browser subscription when backend token removal fails", async () => {
    removeToken.mockRejectedValueOnce(new Error("network unavailable"));
    const subscription = {
      endpoint: "https://push.example/token",
      unsubscribe: vi.fn(async () => true),
    };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistration: vi.fn(async () => ({
          pushManager: {
            getSubscription: vi.fn(async () => subscription),
          },
        })),
      },
    });

    const { useWebPush } = await import("./useWebPush");
    const { result } = renderHook(() => useWebPush());

    await act(async () => {
      await expect(result.current.disable()).resolves.toBe(false);
    });

    expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });
});
