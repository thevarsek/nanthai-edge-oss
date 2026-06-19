import { captureAnalytics } from "@/lib/analytics";

type CtaAuthState = "loading" | "signed_in" | "signed_out";

export function ctaAuthState(isLoaded: boolean, isSignedIn: boolean | undefined): CtaAuthState {
  if (!isLoaded) return "loading";
  return isSignedIn ? "signed_in" : "signed_out";
}

export function captureCtaClick(args: {
  location: string;
  label: string;
  destination: string;
  authState: CtaAuthState;
}) {
  captureAnalytics("cta_clicked", {
    feature_area: "growth",
    cta_location: args.location,
    cta_label: args.label,
    destination: args.destination,
    auth_state: args.authState,
    source_path: typeof window === "undefined" ? undefined : window.location.pathname,
  });
}
