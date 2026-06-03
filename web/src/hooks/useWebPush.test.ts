import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mutationCalls: string[] = [];
const registerToken = vi.fn(async () => {
  mutationCalls.push("registerToken");
});
const removeToken = vi.fn(async () => {
  mutationCalls.push("removeToken");
});
const useMutation = vi.fn();

vi.mock("@convex/_generated/api", () => ({
  api: {
    push: {
      mutations: {
        registerDeviceToken: "registerDeviceToken",
        removeDeviceToken: "removeDeviceToken",
      },
    },
  },
}));

vi.mock("convex/react", () => ({
  useMutation: (mutation: string) => useMutation(mutation),
}));

describe("useWebPush", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    useMutation.mockImplementation((mutation: string) => (
      mutation === "registerDeviceToken" ? registerToken : removeToken
    ));
    mutationCalls.length = 0;
    localStorage.clear();
    Object.defineProperty(window, "PushManager", {
      configurable: true,
      value: class PushManager {},
    });
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: { permission: "granted", requestPermission: vi.fn() },
    });
  });

  it("keeps dismissed notification prompts retryable instead of denied", async () => {
    vi.stubEnv("VITE_WEB_PUSH_VAPID_PUBLIC_KEY", "AQIDBA");
    const requestPermission = vi.fn(async () => "default" as NotificationPermission);
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: { permission: "default", requestPermission },
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistration: vi.fn(async () => ({
          pushManager: {
            getSubscription: vi.fn(async () => null),
            subscribe: vi.fn(),
          },
        })),
      },
    });

    const { useWebPush } = await import("./useWebPush");
    const { result } = renderHook(() => useWebPush());

    await act(async () => {
      await expect(result.current.enable()).resolves.toBe(false);
    });

    expect(requestPermission).toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
    expect(result.current.errorMessage).toBeNull();
    expect(registerToken).not.toHaveBeenCalled();
  });

  it("replaces an existing subscription when the VAPID application server key changes", async () => {
    vi.stubEnv("VITE_WEB_PUSH_VAPID_PUBLIC_KEY", "AQIDBA");
    const oldSubscription = {
      endpoint: "https://push.example/old-token",
      options: { applicationServerKey: new Uint8Array([9, 9, 9]).buffer },
      unsubscribe: vi.fn(async () => {
        mutationCalls.push("unsubscribe");
        return true;
      }),
    };
    const newSubscription = {
      endpoint: "https://push.example/new-token",
      options: { applicationServerKey: new Uint8Array([1, 2, 3, 4]).buffer },
      unsubscribe: vi.fn(),
    };
    const subscribe = vi.fn(async (options: PushSubscriptionOptionsInit) => {
      mutationCalls.push("subscribe");
      expect(Array.from(options.applicationServerKey as Uint8Array)).toEqual([1, 2, 3, 4]);
      return newSubscription;
    });
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: { permission: "granted", requestPermission: vi.fn(async () => "granted" as NotificationPermission) },
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistration: vi.fn(async () => ({
          pushManager: {
            getSubscription: vi.fn(async () => oldSubscription),
            subscribe,
          },
        })),
      },
    });

    const { useWebPush } = await import("./useWebPush");
    const { result } = renderHook(() => useWebPush());

    await act(async () => {
      await expect(result.current.enable()).resolves.toBe(true);
    });

    expect(mutationCalls).toEqual(["unsubscribe", "subscribe", "registerToken"]);
    expect(oldSubscription.unsubscribe).toHaveBeenCalled();
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(registerToken).toHaveBeenCalledWith(expect.objectContaining({
      token: "https://push.example/new-token",
      platform: "web",
      provider: "webpush",
    }));
    expect(result.current.status).toBe("granted");
    expect(result.current.isRegistered).toBe(true);
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
    expect(result.current.status).toBe("idle");
    expect(result.current.isRegistered).toBe(false);
  });

  it("queues backend cleanup retry when token removal fails after browser unsubscribe", async () => {
    const subscription = {
      endpoint: "https://push.example/token",
      unsubscribe: vi.fn(async () => {
        mutationCalls.push("unsubscribe");
        return true;
      }),
    };
    removeToken.mockImplementationOnce(async () => {
      mutationCalls.push("removeToken");
      throw new Error("backend failed");
    });
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

    expect(mutationCalls).toEqual(["unsubscribe", "removeToken"]);
    expect(removeToken).toHaveBeenCalledWith({ token: "https://push.example/token" });
    expect(localStorage.getItem("nanthai.pendingWebPushTokenRemoval")).toBe("https://push.example/token");
  });

  it("does not remove the backend token when browser unsubscribe fails", async () => {
    const subscription = {
      endpoint: "https://push.example/token",
      unsubscribe: vi.fn(async () => {
        mutationCalls.push("unsubscribe");
        throw new Error("browser failed");
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
      await expect(result.current.disable()).resolves.toBe(false);
    });

    expect(mutationCalls).toEqual(["unsubscribe"]);
    expect(removeToken).not.toHaveBeenCalled();
    expect(registerToken).not.toHaveBeenCalled();
  });

  it("clears queued backend cleanup after a retry succeeds even if unmounted", async () => {
    localStorage.setItem("nanthai.pendingWebPushTokenRemoval", "https://push.example/token");
    let resolveRemoval: (() => void) | undefined;
    removeToken.mockImplementationOnce(() => new Promise<void>((resolve) => {
      mutationCalls.push("removeToken");
      resolveRemoval = resolve;
    }));
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistration: vi.fn(async () => null),
      },
    });

    const { useWebPush } = await import("./useWebPush");
    const { unmount } = renderHook(() => useWebPush());

    unmount();
    await act(async () => {
      resolveRemoval?.();
      await Promise.resolve();
    });

    expect(removeToken).toHaveBeenCalledWith({ token: "https://push.example/token" });
    expect(localStorage.getItem("nanthai.pendingWebPushTokenRemoval")).toBeNull();
  });
});
