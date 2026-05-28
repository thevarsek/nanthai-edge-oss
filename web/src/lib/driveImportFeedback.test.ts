import { ConvexError } from "convex/values";
import type { TFunction } from "i18next";
import { describe, expect, it, vi } from "vitest";

import {
  driveImportErrorMessage,
  driveImportProgressMessage,
  formatDriveImportSize,
} from "./driveImportFeedback";

const t = vi.fn((key: string, values?: Record<string, unknown>) => (
  `${key}:${JSON.stringify(values ?? {})}`
)) as unknown as TFunction;

describe("driveImportFeedback", () => {
  it("formats KB and MB limits for Drive import errors", () => {
    expect(formatDriveImportSize(1536, "en-US")).toBe("2 KB");
    expect(formatDriveImportSize(1_572_864, "en-US")).toBe("1.5 MB");
  });

  it("uses structured Convex file-size errors before generic fallbacks", () => {
    const error = new ConvexError({
      code: "DRIVE_FILE_TOO_LARGE",
      filename: "large.pdf",
      maxBytes: 25 * 1024 * 1024,
      sizeBytes: 32 * 1024 * 1024,
    });

    expect(driveImportErrorMessage(error, "fallback.pdf", t, "en-US")).toBe(
      'kb_drive_import_file_too_large:{"filename":"large.pdf","maxSize":"25 MB","size":"32 MB"}',
    );
  });

  it("builds progress copy with and without the current filename", () => {
    expect(driveImportProgressMessage({ current: 1, total: 3 }, t)).toBe(
      'kb_drive_import_progress:{"current":1,"total":3}',
    );
    expect(driveImportProgressMessage({ current: 2, total: 3, filename: "Brief.pdf" }, t)).toBe(
      'kb_drive_import_progress_file:{"current":2,"total":3,"filename":"Brief.pdf"}',
    );
  });
});
