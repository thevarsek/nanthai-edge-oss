import { useEffect } from "react";
import { useAuth } from "@clerk/react";
import { clearAuthenticatedCaches } from "@/lib/clearAuthenticatedCaches";

/**
 * Purges service-worker caches that may hold a previous user's files whenever
 * the session is signed out (explicit sign-out, expiry or account deletion).
 */
export function SignOutCacheBridge() {
  const { isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    if (isLoaded && !isSignedIn) void clearAuthenticatedCaches();
  }, [isLoaded, isSignedIn]);

  return null;
}
