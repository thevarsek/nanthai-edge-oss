import { useCallback, useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";

const WEB_PUSH_VAPID_PUBLIC_KEY = import.meta.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY as string | undefined;

function base64UrlToUint8Array(base64Url: string) {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function getInitialPushStatus(): "idle" | "unsupported" | "requesting" | "granted" | "denied" | "error" {
  if (typeof window === "undefined") return "idle";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification === "undefined") {
    return "unsupported";
  }
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  return "idle";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Push notification setup failed.";
}

export function useWebPush() {
  const registerToken = useMutation(api.push.mutations.registerDeviceToken);
  const removeToken = useMutation(api.push.mutations.removeDeviceToken);
  const [status, setStatus] = useState<"idle" | "unsupported" | "requesting" | "granted" | "denied" | "error">(
    () => getInitialPushStatus(),
  );
  const [isRegistered, setIsRegistered] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unsupported" || typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (!cancelled) {
          setIsRegistered(subscription !== null);
        }
      } catch {
        if (!cancelled) {
          setIsRegistered(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  const enable = useCallback(async () => {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification === "undefined") {
        setStatus("unsupported");
        setErrorMessage(null);
        return false;
      }
      if (!WEB_PUSH_VAPID_PUBLIC_KEY) {
        setStatus("error");
        setErrorMessage("Push notifications are not configured on this build.");
        return false;
      }

      setErrorMessage(null);
      setStatus("requesting");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("denied");
        setErrorMessage(null);
        return false;
      }

      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(WEB_PUSH_VAPID_PUBLIC_KEY),
      });

      const token = subscription.endpoint;
      await registerToken({
        token,
        platform: "web",
        provider: "webpush",
        subscription: JSON.stringify(subscription),
      });

      setStatus("granted");
      setIsRegistered(true);
      setErrorMessage(null);
      return true;
    } catch (error) {
      setStatus("error");
      setErrorMessage(getErrorMessage(error));
      return false;
    }
  }, [registerToken]);

  const disable = useCallback(async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await removeToken({ token: subscription.endpoint });
        await subscription.unsubscribe();
      }
      setIsRegistered(false);
      setErrorMessage(null);
      return true;
    } catch (error) {
      setStatus("error");
      setErrorMessage(getErrorMessage(error));
      return false;
    }
  }, [removeToken]);

  return {
    status,
    isRegistered,
    errorMessage,
    isConfigured: !!WEB_PUSH_VAPID_PUBLIC_KEY,
    isSupported: status !== "unsupported",
    enable,
    disable,
  };
}
