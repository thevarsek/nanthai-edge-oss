export type PresentationExportErrorCode =
  | "empty_slide_roots"
  | "font_load_failed"
  | "image_load_failed"
  | "image_load_timed_out"
  | "converter_unavailable"
  | "conversion_failed"
  | "download_failed";

export interface PresentationExportErrorDetails {
  readonly slideIndex?: number;
  readonly imageSource?: string;
  readonly timeoutMs?: number;
}

export class PresentationExportError extends Error {
  readonly code: PresentationExportErrorCode;
  readonly details: PresentationExportErrorDetails;

  constructor(
    code: PresentationExportErrorCode,
    message: string,
    details: PresentationExportErrorDetails = {},
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PresentationExportError";
    this.code = code;
    this.details = details;
  }
}
