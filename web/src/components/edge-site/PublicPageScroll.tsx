import { useLayoutEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/** Reset ordinary page navigation after its lazy content mounts; leave anchors and Back alone. */
export function PublicPageScroll() {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();
  useLayoutEffect(() => {
    if (navigationType !== "POP" && !hash) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }
  }, [pathname, hash, navigationType]);
  return null;
}
