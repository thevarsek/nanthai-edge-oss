import { render, screen } from "@testing-library/react";
import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import {
  ModelMediaCapabilitiesSection,
} from "./ModelMediaCapabilities";
import {
  compactMediaSummary,
  type ModelMediaCapabilities,
} from "./ModelMediaCapabilities.utils";

const t = i18n.t.bind(i18n) as TFunction;

const imageCapabilities: ModelMediaCapabilities = {
  image: {
    countMin: 1,
    countMax: 10,
    aspectRatios: ["1:1", "16:9"],
    resolutions: ["1K", "2K", "4K"],
    sizes: [],
    qualities: ["low", "medium", "high"],
    backgrounds: ["opaque", "transparent"],
    outputFormats: ["png", "webp"],
    maxInputReferences: 16,
    supportsStreaming: false,
  },
};

const exactCountCapabilities: ModelMediaCapabilities = {
  image: {
    counts: [4, 1, 4],
    countMin: 1,
    countMax: 10,
    aspectRatios: [],
    resolutions: [],
    sizes: [],
    qualities: [],
    backgrounds: [],
    outputFormats: [],
    supportsStreaming: false,
  },
};

describe("compactMediaSummary", () => {
  it("selects at most three high-signal image capabilities", () => {
    expect(compactMediaSummary(t, imageCapabilities)).toEqual([
      "Up to 10 images",
      "Image editing",
      "4K",
    ]);
  });

  it("summarizes video input, audio, and best resolution", () => {
    expect(compactMediaSummary(t, {
      video: {
        resolutions: ["720p", "1080p"],
        aspectRatios: ["16:9"],
        durations: [4, 8],
        frameImages: ["first_frame"],
        supportsAudio: true,
        supportsSeed: false,
      },
    })).toEqual(["Image-to-Video", "Audio", "1080p"]);
  });

  it("prefers the exact image-count maximum over legacy bounds", () => {
    expect(compactMediaSummary(t, exactCountCapabilities)).toEqual([
      "Up to 4 images",
    ]);
  });

  it("accepts a live-shaped exact-count payload", () => {
    const payload = JSON.parse(`{
      "image": {
        "counts": [1.0, 4.0],
        "aspectRatios": [],
        "resolutions": ["2K"],
        "sizes": [],
        "qualities": [],
        "backgrounds": [],
        "outputFormats": [],
        "supportsStreaming": false,
        "futureCapability": true
      }
    }`) as ModelMediaCapabilities;

    expect(compactMediaSummary(t, payload)).toEqual(["Up to 4 images", "2K"]);
  });
});

describe("ModelMediaCapabilitiesSection", () => {
  it("renders exact image ranges and localized option labels", () => {
    render(<ModelMediaCapabilitiesSection capabilities={imageCapabilities} />);

    expect(screen.getByText("Generation options")).toBeInTheDocument();
    expect(screen.getByText("Images per request")).toBeInTheDocument();
    expect(screen.getByText("1–10")).toBeInTheDocument();
    expect(screen.getByText("1K, 2K, 4K")).toBeInTheDocument();
    expect(screen.getByText("PNG, WEBP")).toBeInTheDocument();
    expect(screen.getByText("Not supported")).toBeInTheDocument();
  });

  it("renders discrete counts instead of a misleading continuous range", () => {
    render(<ModelMediaCapabilitiesSection capabilities={exactCountCapabilities} />);

    expect(screen.getByText("1, 4")).toBeInTheDocument();
    expect(screen.queryByText("1–10")).not.toBeInTheDocument();
  });

  it("renders video durations, frame roles, audio, and seed support", () => {
    render(<ModelMediaCapabilitiesSection capabilities={{
      video: {
        resolutions: ["1080p"],
        aspectRatios: ["16:9", "9:16"],
        durations: [8, 4],
        frameImages: ["first_frame", "last_frame"],
        supportsAudio: true,
        supportsSeed: false,
      },
    }} />);

    expect(screen.getByText("4s, 8s")).toBeInTheDocument();
    expect(screen.getByText("First frame, Last frame")).toBeInTheDocument();
    expect(screen.getByText("Audio generation")).toBeInTheDocument();
    expect(screen.getByText("Seed control")).toBeInTheDocument();
  });

  it("stays hidden for non-media models", () => {
    const { container } = render(<ModelMediaCapabilitiesSection />);
    expect(container).toBeEmptyDOMElement();
  });
});
