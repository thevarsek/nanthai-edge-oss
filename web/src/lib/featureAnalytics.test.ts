import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureSendFeatureUsage } from "./featureAnalytics";

const { captureAnalytics } = vi.hoisted(() => ({
  captureAnalytics: vi.fn(),
}));

vi.mock("@/lib/analytics", () => ({
  captureAnalytics,
}));

describe("captureSendFeatureUsage", () => {
  beforeEach(() => {
    captureAnalytics.mockClear();
  });

  it("does not classify audio-only attachments as image/video usage", () => {
    captureSendFeatureUsage({
      chat_id: "chat_1",
      has_audio: true,
      has_attachments: true,
      has_image_attachment: false,
      has_video_config: false,
      attachment_count: 1,
    });

    expect(captureAnalytics).toHaveBeenCalledWith(
      "feature_used",
      expect.objectContaining({
        feature_area: "audio",
        feature: "audio_input",
      }),
    );
    expect(captureAnalytics).not.toHaveBeenCalledWith(
      "feature_used",
      expect.objectContaining({
        feature_area: "image_video",
      }),
    );
  });

  it("classifies image attachments as image/video usage", () => {
    captureSendFeatureUsage({
      chat_id: "chat_1",
      has_attachments: true,
      has_image_attachment: true,
      has_video_config: false,
      attachment_count: 1,
    });

    expect(captureAnalytics).toHaveBeenCalledWith(
      "feature_used",
      expect.objectContaining({
        feature_area: "image_video",
        feature: "image_attachment",
      }),
    );
  });
});
