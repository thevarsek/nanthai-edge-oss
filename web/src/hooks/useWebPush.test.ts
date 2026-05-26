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

  it("unsubscribes the browser subscription before removing the backend token", async () => {
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

    expect(mutationCalls).toEqual(["unsubscribe", "removeToken"]);
    expect(removeToken).toHaveBeenCalledWith({ token: "https://push.example/token" });
  });

  it("keeps the backend token when browser unsubscribe fails", async () => {
    const subscription = {
      endpoint: "https://push.example/token",
      unsubscribe: vi.fn(async () => false),
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

    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(removeToken).not.toHaveBeenCalled();
  });
});
