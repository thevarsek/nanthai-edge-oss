import { captureAnalytics } from "@/lib/analytics";

export type OutboundDestination =
  | "app_store"
  | "facebook"
  | "github"
  | "instagram"
  | "linkedin"
  | "play_store"
  | "x";

export function captureOutboundClick(args: {
  destination: OutboundDestination;
  location: string;
}) {
  captureAnalytics("outbound_clicked", {
    feature_area: "growth",
    destination_type: args.destination,
    link_location: args.location,
    source_path: typeof window === "undefined" ? undefined : window.location.pathname,
  });
}
