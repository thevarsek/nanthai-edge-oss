import type { ComponentPropsWithoutRef, MouseEvent } from "react";
import {
  captureOutboundClick,
  type OutboundDestination,
} from "@/lib/outboundAnalytics";

type TrackedOutboundLinkProps = ComponentPropsWithoutRef<"a"> & {
  destination: OutboundDestination;
  location: string;
};

export function TrackedOutboundLink({
  destination,
  location,
  onClick,
  ...props
}: TrackedOutboundLinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    captureOutboundClick({ destination, location });
    onClick?.(event);
  };

  return <a {...props} onClick={handleClick} />;
}
