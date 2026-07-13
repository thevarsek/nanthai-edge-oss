import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureAnalytics } from "@/lib/analytics";
import { captureOutboundClick } from "./outboundAnalytics";

vi.mock("@/lib/analytics", () => ({ captureAnalytics: vi.fn() }));

describe("outbound analytics", () => {
  beforeEach(() => vi.mocked(captureAnalytics).mockReset());

  it("captures a safe destination key without sending the destination URL", () => {
    captureOutboundClick({ destination: "app_store", location: "home_hero" });

    expect(captureAnalytics).toHaveBeenCalledWith("outbound_clicked", {
      feature_area: "growth",
      destination_type: "app_store",
      link_location: "home_hero",
      source_path: "/",
    });
    expect(JSON.stringify(vi.mocked(captureAnalytics).mock.calls)).not.toContain("apps.apple.com");
  });
});
