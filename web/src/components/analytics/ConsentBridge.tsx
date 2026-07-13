import { lazy, Suspense } from "react";
import { useLocation } from "react-router-dom";
import { isPublicConsentRoute } from "@/lib/analyticsConsent";

const PublicConsentManager = lazy(() => import("./PublicConsentManager"));

export function ConsentBridge() {
  const { pathname } = useLocation();

  if (!isPublicConsentRoute(pathname)) return null;

  return (
    <Suspense fallback={null}>
      <PublicConsentManager />
    </Suspense>
  );
}
