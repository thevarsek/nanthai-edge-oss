import { TFunction } from "i18next";
import { convexErrorData, convexErrorMessage } from "@/lib/convexErrors";

type DriveImportErrorData = {
  code?: string;
  filename?: string;
  maxBytes?: number;
  sizeBytes?: number;
};

export type DriveImportProgress = {
  current: number;
  total: number;
  filename?: string;
};

export function formatDriveImportSize(bytes: number, locale?: string): string {
  const unit = bytes >= 1024 * 1024 ? "MB" : "KB";
  const value = unit === "MB" ? bytes / (1024 * 1024) : bytes / 1024;
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: unit === "MB" ? 1 : 0,
  }).format(value)} ${unit}`;
}

export function driveImportErrorMessage(
  error: unknown,
  fallbackFilename: string,
  t: TFunction,
  locale?: string,
): string {
  const data = convexErrorData(error) as DriveImportErrorData | undefined;
  if (data?.code === "DRIVE_FILE_TOO_LARGE") {
    return t("kb_drive_import_file_too_large", {
      filename: data.filename ?? fallbackFilename,
      maxSize: formatDriveImportSize(data.maxBytes ?? 25 * 1024 * 1024, locale),
      size: data.sizeBytes ? formatDriveImportSize(data.sizeBytes, locale) : undefined,
    });
  }

  const message = convexErrorMessage(error, "");
  if (message) return message;

  return t("kb_drive_import_file_failed", { filename: fallbackFilename });
}

export function driveImportProgressMessage(
  progress: DriveImportProgress,
  t: TFunction,
): string {
  return progress.filename
    ? t("kb_drive_import_progress_file", {
      current: progress.current,
      total: progress.total,
      filename: progress.filename,
    })
    : t("kb_drive_import_progress", {
      current: progress.current,
      total: progress.total,
    });
}
