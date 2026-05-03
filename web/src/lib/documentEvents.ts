export type DocumentEventAttachmentPayload = {
  storageId: string;
  filename: string;
  mimeType: string;
};

export function hasDocumentAttachmentPayload(
  event: {
    storageId?: unknown;
    filename?: unknown;
    mimeType?: unknown;
  },
): event is DocumentEventAttachmentPayload {
  return (
    typeof event.storageId === "string" &&
    event.storageId.length > 0 &&
    typeof event.filename === "string" &&
    event.filename.length > 0 &&
    typeof event.mimeType === "string" &&
    event.mimeType.length > 0
  );
}
