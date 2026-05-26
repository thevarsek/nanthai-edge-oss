// web/src/hooks/usePWAInstall.ts
// =============================================================================
// PWA install prompt — wraps the browser's beforeinstallprompt event.
// Works on Chrome/Edge/Android. On iOS Safari we surface manual instructions.
// =============================================================================

import { useState, useEffect, useCallback } from "react";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

interface PWAInstallState {
  /** True when a native install prompt is available (Chrome/Edge/Android) */
  canInstall: boolean;
  /** True when running on iOS Safari where we show manual instructions */
  isIOS: boolean;
  /** True when the app is already running in standalone/installed mode */
  isInstalled: boolean;
  /** Call this to trigger the native install prompt */
  install: () => Promise<"accepted" | "dismissed" | "unavailable">;
  /** Dismiss the banner without installing */
  dismiss: () => void;
  /** Whether the install banner should be shown */
  showBanner: boolean;
  /** True while the native prompt is waiting for the browser/user response. */
  isInstalling: boolean;
}

const DISMISSED_KEY = "nanth_install_dismissed";

function readDismissedState(): boolean {
  try {
    return typeof sessionStorage !== "undefined" && sessionStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function detectIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPad on iOS 13+ reports as MacIntel
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    // iOS Safari standalone
    ("standalone" in window.navigator && (window.navigator as { standalone?: boolean }).standalone === true)
  );
}

export function usePWAInstall(): PWAInstallState {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isPromptPending, setIsPromptPending] = useState(false);
  const [dismissed, setDismissed] = useState(() => readDismissedState());

  const isIOS = detectIOS();
  const isInstalled = detectStandalone();
  const canInstall = deferredPrompt !== null;

  useEffect(() => {
    if (typeof window === "undefined") return;
    function handleBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }

    function handleAppInstalled() {
      setDeferredPrompt(null);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const install = useCallback(async (): Promise<"accepted" | "dismissed" | "unavailable"> => {
    if (!deferredPrompt || isPromptPending) return "unavailable";
    setIsPromptPending(true);
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      return outcome;
    } finally {
      setIsPromptPending(false);
    }
  }, [deferredPrompt, isPromptPending]);

  const dismiss = useCallback(() => {
    try {
      sessionStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Storage can be unavailable in private or embedded browser contexts.
    }
    setDismissed(true);
  }, []);

  const showBanner = !isInstalled && !dismissed && (canInstall || isIOS);

  return { canInstall, isIOS, isInstalled, install, dismiss, showBanner, isInstalling: isPromptPending };
}
