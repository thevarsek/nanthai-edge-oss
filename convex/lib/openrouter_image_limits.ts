/**
 * Keep one generated image comfortably below the Node action memory ceiling.
 *
 * A streamed item temporarily exists as JSON text, a parsed base64 string,
 * decoded bytes, and a Blob. The storage limit is higher, but accepting a
 * storage-sized inline payload would allow those representations to overlap.
 */
export const MAX_GENERATED_IMAGE_BYTES = 32 * 1024 * 1024;

export const MAX_GENERATED_IMAGE_BASE64_CHARS =
  Math.ceil(MAX_GENERATED_IMAGE_BYTES / 3) * 4;

/** Allow a small JSON envelope around the base64 payload. */
export const MAX_IMAGE_RESPONSE_OBJECT_CHARS =
  MAX_GENERATED_IMAGE_BASE64_CHARS + 64 * 1024;
