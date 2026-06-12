import { useEffect, useRef } from "react";
import { useUser } from "@clerk/react";
import { useConvexAuth, useQuery } from "convex/react";
import { useLocation } from "react-router-dom";
import { api } from "@convex/_generated/api";
import {
  captureAnalytics,
  identifyAnalyticsUser,
  initAnalytics,
  isAnalyticsUserIdentified,
  resetAnalyticsUser,
} from "@/lib/analytics";

export function AnalyticsBridge() {
  const location = useLocation();
  const { isLoaded, isSignedIn, user } = useUser();
  const { isAuthenticated: isConvexAuthenticated, isLoading: isConvexLoading } = useConvexAuth();
  const analyticsIdentity = useQuery(
    api.analytics.identity.getAnalyticsIdentity,
    isLoaded && isSignedIn && isConvexAuthenticated && user?.id
      ? { clerkUserId: user.id }
      : "skip",
  );
  const identifiedAnalyticsId = useRef<string | null>(null);
  const identifiedClerkUserId = useRef<string | null>(null);
  const lastPageViewKey = useRef<string | null>(null);
  const capturedAppOpened = useRef(false);
  const capturedAppReady = useRef(false);
  const shouldCaptureNextSignInCompletion = useRef(false);

  useEffect(() => {
    initAnalytics();
  }, []);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn || !user) {
      if (identifiedAnalyticsId.current !== null || isAnalyticsUserIdentified()) {
        captureAnalytics("sign_out", {
          feature_area: "auth",
          source: "analytics_bridge",
        });
        resetAnalyticsUser();
        identifiedAnalyticsId.current = null;
        identifiedClerkUserId.current = null;
      }
      shouldCaptureNextSignInCompletion.current = true;
      return;
    }

    if (!isConvexAuthenticated || analyticsIdentity === undefined) return;

    if (analyticsIdentity === null) {
      if (identifiedAnalyticsId.current !== null || isAnalyticsUserIdentified()) {
        resetAnalyticsUser();
      }
      identifiedAnalyticsId.current = null;
      identifiedClerkUserId.current = null;
      return;
    }

    const clerkUserId = user.id;
    const analyticsId = analyticsIdentity.analyticsId;
    if (
      (identifiedClerkUserId.current !== null && identifiedClerkUserId.current !== clerkUserId) ||
      (identifiedClerkUserId.current === null &&
        identifiedAnalyticsId.current === null &&
        isAnalyticsUserIdentified())
    ) {
      resetAnalyticsUser();
      identifiedAnalyticsId.current = null;
      identifiedClerkUserId.current = null;
      lastPageViewKey.current = null;
    }

    if (
      identifiedAnalyticsId.current !== analyticsId ||
      identifiedClerkUserId.current !== clerkUserId ||
      (identifiedAnalyticsId.current === null && !isAnalyticsUserIdentified())
    ) {
      identifyAnalyticsUser(analyticsId);
      if (shouldCaptureNextSignInCompletion.current) {
        captureAnalytics("sign_in_completed", {
          feature_area: "auth",
        });
        shouldCaptureNextSignInCompletion.current = false;
      }
      identifiedAnalyticsId.current = analyticsId;
      identifiedClerkUserId.current = clerkUserId;
    }
  }, [analyticsIdentity, isConvexAuthenticated, isLoaded, isSignedIn, user]);

  useEffect(() => {
    if (!isLifecycleReadyForAuth({
      analyticsIdentity,
      hasUser: Boolean(user),
      identifiedAnalyticsId: identifiedAnalyticsId.current,
      identifiedClerkUserId: identifiedClerkUserId.current,
      isLoaded,
      isSignedIn,
      userId: user?.id ?? null,
    }) || capturedAppOpened.current) return;
    capturedAppOpened.current = true;
    captureAnalytics("app_opened", {
      feature_area: "lifecycle",
    });
  }, [analyticsIdentity, isLoaded, isSignedIn, user]);

  useEffect(() => {
    if (!isLifecycleReadyForAuth({
      analyticsIdentity,
      hasUser: Boolean(user),
      identifiedAnalyticsId: identifiedAnalyticsId.current,
      identifiedClerkUserId: identifiedClerkUserId.current,
      isLoaded,
      isSignedIn,
      userId: user?.id ?? null,
    })) return;
    const path = location.pathname;
    if (lastPageViewKey.current === path) return;
    lastPageViewKey.current = path;
    captureAnalytics("page_viewed", {
      feature_area: "navigation",
      path,
      pathname: location.pathname,
      search_present: location.search.length > 0,
    });
    const featureArea = featureAreaForPath(location.pathname);
    if (featureArea) {
      captureAnalytics("feature_used", {
        feature_area: featureArea,
        feature: featureArea,
        action: "page_viewed",
        path,
        pathname: location.pathname,
      });
    }
  }, [analyticsIdentity, isLoaded, isSignedIn, location.key, location.pathname, location.search, user]);

  useEffect(() => {
    if (
      capturedAppReady.current ||
      isConvexLoading ||
      !isLifecycleReadyForAuth({
        analyticsIdentity,
        hasUser: Boolean(user),
        identifiedAnalyticsId: identifiedAnalyticsId.current,
        identifiedClerkUserId: identifiedClerkUserId.current,
        isLoaded,
        isSignedIn,
        userId: user?.id ?? null,
      })
    ) return;
    capturedAppReady.current = true;
    captureAnalytics("app_ready", {
      feature_area: "lifecycle",
      signed_in: isSignedIn === true,
      convex_authenticated: isConvexAuthenticated === true,
    });
  }, [analyticsIdentity, isConvexAuthenticated, isConvexLoading, isLoaded, isSignedIn, user]);

  return null;
}

function featureAreaForPath(pathname: string): string | null {
  if (pathname.includes("/personas")) return "personas";
  if (pathname.includes("/memory")) return "memory";
  if (pathname.includes("/knowledge")) return "docs_drive";
  if (pathname.includes("/settings")) return "settings";
  if (pathname.includes("/chat")) return "chat";
  return null;
}

function isLifecycleReadyForAuth(args: {
  analyticsIdentity: { analyticsId: string } | null | undefined;
  hasUser: boolean;
  identifiedAnalyticsId: string | null;
  identifiedClerkUserId: string | null;
  isLoaded: boolean;
  isSignedIn: boolean | undefined;
  userId: string | null;
}): boolean {
  if (!args.isLoaded) return false;
  if (!args.isSignedIn || !args.hasUser) return true;
  if (args.analyticsIdentity === undefined || args.analyticsIdentity === null) return false;
  if (!args.userId || args.identifiedClerkUserId !== args.userId) return false;
  return args.identifiedAnalyticsId === args.analyticsIdentity.analyticsId;
}
