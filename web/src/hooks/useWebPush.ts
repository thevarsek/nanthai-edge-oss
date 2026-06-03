import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";

const WEB_PUSH_VAPID_PUBLIC_KEY = import.meta.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY as string | undefined;
const PENDING_WEB_PUSH_TOKEN_REMOVAL_KEY = "nanthai.pendingWebPushTokenRemoval";

function base64UrlToUint8Array(base64Url: string) {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function subscriptionMatchesApplicationServerKey(
  subscription: PushSubscription,
  applicationServerKey: Uint8Array,
): boolean {
  const existingKey = subscription.options.applicationServerKey;
  if (!existingKey) return true;
  const existingBytes = new Uint8Array(existingKey);
  if (existingBytes.length !== applicationServerKey.length) return false;
  return existingBytes.every((byte, index) => byte === applicationServerKey[index]);
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

async function getActiveServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) {
    throw new Error("Push notifications are not ready yet. Reload the page and try again.");
  }
  return registration;
}

function getPendingTokenRemoval(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(PENDING_WEB_PUSH_TOKEN_REMOVAL_KEY);
}

function setPendingTokenRemoval(token: string) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(PENDING_WEB_PUSH_TOKEN_REMOVAL_KEY, token);
}

function clearPendingTokenRemoval(token: string) {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(PENDING_WEB_PUSH_TOKEN_REMOVAL_KEY) === token) {
    localStorage.removeItem(PENDING_WEB_PUSH_TOKEN_REMOVAL_KEY);
  }
}

export function useWebPush() {
  const registerToken = useMutation(api.push.mutations.registerDeviceToken);
  const removeToken = useMutation(api.push.mutations.removeDeviceToken);
  const [status, setStatus] = useState<"idle" | "unsupported" | "requesting" | "granted" | "denied" | "error">(
    () => getInitialPushStatus(),
  );
  const [isRegistered, setIsRegistered] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const registrationProbeId = useRef(0);

  useEffect(() => {
    if (status === "idle" || status === "unsupported" || typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    let cancelled = false;
    const probeId = registrationProbeId.current + 1;
    registrationProbeId.current = probeId;
    void (async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        if (!registration) {
          if (!cancelled && registrationProbeId.current === probeId) {
            setIsRegistered(false);
          }
          return;
        }
        const subscription = await registration.pushManager.getSubscription();
        if (!cancelled && registrationProbeId.current === probeId) {
          setIsRegistered(subscription !== null);
        }
      } catch {
        if (!cancelled && registrationProbeId.current === probeId) {
          setIsRegistered(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  useEffect(() => {
    const pendingToken = getPendingTokenRemoval();
    if (!pendingToken) return;

    void removeToken({ token: pendingToken }).then(() => {
      clearPendingTokenRemoval(pendingToken);
    }).catch(() => {
      // Keep the token queued so a later hook mount can retry backend cleanup.
    });
  }, [removeToken]);

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
      if (permission === "denied") {
        setStatus("denied");
        setErrorMessage(null);
        return false;
      }
      if (permission !== "granted") {
        setStatus("idle");
        setErrorMessage(null);
        return false;
      }

      const registration = await getActiveServiceWorkerRegistration();
      const applicationServerKey = base64UrlToUint8Array(WEB_PUSH_VAPID_PUBLIC_KEY);
      const existing = await registration.pushManager.getSubscription();
      let subscription = existing;
      if (subscription && !subscriptionMatchesApplicationServerKey(subscription, applicationServerKey)) {
        const didUnsubscribe = await subscription.unsubscribe();
        if (!didUnsubscribe) {
          throw new Error("Browser push subscription could not be refreshed.");
        }
        subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
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
      const registration = await getActiveServiceWorkerRegistration();
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const token = subscription.endpoint;
        const didUnsubscribe = await subscription.unsubscribe();
        if (!didUnsubscribe) {
          throw new Error("Browser push subscription could not be removed.");
        }
        try {
          await removeToken({ token });
          clearPendingTokenRemoval(token);
        } catch (removeError) {
          setPendingTokenRemoval(token);
          throw removeError;
        }
      }
      registrationProbeId.current += 1;
      setIsRegistered(false);
      setStatus("idle");
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
