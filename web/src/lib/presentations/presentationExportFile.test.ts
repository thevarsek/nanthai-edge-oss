import { describe, expect, it, vi } from "vitest";
import {
  downloadPresentation,
  normalizePptxBlob,
  PPTX_MIME_TYPE,
  safePresentationFileName,
} from "./presentationExportFile";

function readBlobAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsText(blob);
  });
}

describe("presentation export files", () => {
  it("normalizes the PPTX MIME type without changing the payload", async () => {
    const normalized = normalizePptxBlob(new Blob(["deck"], { type: "application/zip" }));

    expect(normalized.type).toBe(PPTX_MIME_TYPE);
    expect(await readBlobAsText(normalized)).toBe("deck");
  });

  it("creates safe PPTX filenames", () => {
    expect(safePresentationFileName()).toBe("presentation.pptx");
    expect(safePresentationFileName("  Q3 / Board: Review.PPTX  ")).toBe(
      "Q3 - Board - Review.pptx",
    );
    expect(safePresentationFileName("CON")).toBe("presentation-CON.pptx");
    expect(safePresentationFileName("con.notes")).toBe("presentation-con.notes.pptx");
    expect(safePresentationFileName("Q3\u202ereview")).toBe("Q3 - review.pptx");
    expect(safePresentationFileName("../..")).toBe("presentation.pptx");
  });

  it("downloads with the normalized Blob and defers object URL revocation", () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:presentation");
    const revokeObjectURL = vi.fn();
    const scheduledCleanups: Array<() => void> = [];
    const scheduledDelays: number[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    const fileName = downloadPresentation(new Blob(["deck"], { type: "application/zip" }), "Plan", {
      document,
      objectUrls: { createObjectURL, revokeObjectURL },
      scheduleCleanup: (cleanup, delayMs) => {
        scheduledCleanups.push(cleanup);
        scheduledDelays.push(delayMs);
      },
    });

    expect(fileName).toBe("Plan.pptx");
    expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: PPTX_MIME_TYPE }));
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(scheduledCleanups).toHaveLength(1);
    expect(scheduledDelays).toEqual([30_000]);
    expect(document.querySelector('a[download="Plan.pptx"]')).not.toBeNull();
    scheduledCleanups[0]?.();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:presentation");
    expect(document.querySelector('a[download="Plan.pptx"]')).toBeNull();
    click.mockRestore();
  });
});
