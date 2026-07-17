import { Suspense, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

interface AppRouteBoundaryProps {
  children: ReactNode;
  resetOnLocationChange?: boolean;
}

export function AppRouteBoundary({
  children,
  resetOnLocationChange = true,
}: AppRouteBoundaryProps) {
  const location = useLocation();
  const boundaryKey = resetOnLocationChange ? location.key : "stable";

  return (
    <ErrorBoundary key={boundaryKey} level="route">
      <Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center bg-background">
            <LoadingSpinner size="lg" />
          </div>
        }
      >
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}
