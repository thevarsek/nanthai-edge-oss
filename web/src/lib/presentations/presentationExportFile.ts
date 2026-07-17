import { PresentationExportError } from "./presentationExportError";

export const PPTX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const DEFAULT_FILE_NAME = "presentation";
const OBJECT_URL_REVOCATION_DELAY_MS = 30_000;
const MAX_BASE_NAME_CHARACTERS = 120;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const UNSAFE_FILE_NAME_CHARACTERS = '<>:"/\\|?*';
const UNSAFE_UNICODE_FORMAT_CHARACTER = /[\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;

function replaceUnsafeFileNameCharacters(value: string): string {
  let result = "";
  let previousCharacterWasUnsafe = false;

  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    const isUnsafe = codePoint <= 31 ||
      UNSAFE_FILE_NAME_CHARACTERS.includes(character) ||
      UNSAFE_UNICODE_FORMAT_CHARACTER.test(character);
    if (isUnsafe) {
      if (!previousCharacterWasUnsafe) {
        result = result.trimEnd();
        if (result && !result.endsWith("-")) {
          result += " - ";
        }
      }
    } else {
      result += character;
    }
    previousCharacterWasUnsafe = isUnsafe;
  }

  return result;
}

export function normalizePptxBlob(blob: Blob): Blob {
  return blob.type === PPTX_MIME_TYPE ? blob : blob.slice(0, blob.size, PPTX_MIME_TYPE);
}

export function safePresentationFileName(suggestedFileName?: string): string {
  const withoutExtension = (suggestedFileName ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/(?:\.pptx)+$/i, "")
    .replace(/\s+/g, " ");
  const safeBaseName = replaceUnsafeFileNameCharacters(withoutExtension)
    .replace(/\s+/g, " ")
    .replace(/^[.\s-]+|[.\s-]+$/g, "");

  let baseName = Array.from(safeBaseName)
    .slice(0, MAX_BASE_NAME_CHARACTERS)
    .join("")
    .replace(/[.\s-]+$/g, "")
    .trim();

  if (!baseName) {
    baseName = DEFAULT_FILE_NAME;
  } else if (WINDOWS_RESERVED_NAME.test(baseName)) {
    baseName = `${DEFAULT_FILE_NAME}-${baseName}`;
  }

  return `${baseName}.pptx`;
}

export interface PresentationDownloadEnvironment {
  readonly document: Document;
  readonly objectUrls: {
    createObjectURL(blob: Blob): string;
    revokeObjectURL(url: string): void;
  };
  readonly scheduleCleanup?: (cleanup: () => void, delayMs: number) => void;
}

function scheduleDownloadCleanup(
  environment: PresentationDownloadEnvironment,
  objectUrl: string,
  anchor: HTMLAnchorElement,
): void {
  const cleanup = () => {
    anchor.remove();
    environment.objectUrls.revokeObjectURL(objectUrl);
  };
  if (environment.scheduleCleanup) {
    environment.scheduleCleanup(cleanup, OBJECT_URL_REVOCATION_DELAY_MS);
    return;
  }
  const timerWindow = environment.document.defaultView;
  if (timerWindow) timerWindow.setTimeout(cleanup, OBJECT_URL_REVOCATION_DELAY_MS);
  else setTimeout(cleanup, OBJECT_URL_REVOCATION_DELAY_MS);
}

export function downloadPresentation(
  blob: Blob,
  suggestedFileName?: string,
  environment: PresentationDownloadEnvironment = {
    document,
    objectUrls: URL,
  },
): string {
  const body = environment.document.body;
  if (!body) {
    throw new PresentationExportError("download_failed", "The presentation cannot be downloaded yet.");
  }

  const fileName = safePresentationFileName(suggestedFileName);
  const normalizedBlob = blob.type === PPTX_MIME_TYPE ? blob : normalizePptxBlob(blob);
  let objectUrl: string | undefined;
  let anchor: HTMLAnchorElement | undefined;

  try {
    objectUrl = environment.objectUrls.createObjectURL(normalizedBlob);
    anchor = environment.document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.hidden = true;
    body.appendChild(anchor);
    anchor.click();
    return fileName;
  } catch (error) {
    throw new PresentationExportError(
      "download_failed",
      "The presentation download could not be started.",
      {},
      error,
    );
  } finally {
    if (objectUrl && anchor) scheduleDownloadCleanup(environment, objectUrl, anchor);
    else anchor?.remove();
  }
}
