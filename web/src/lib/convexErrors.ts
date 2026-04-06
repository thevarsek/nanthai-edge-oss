import { ConvexError } from "convex/values";

/**
 * Extract a user-friendly error message from a Convex mutation/action error.
 *
 * The Convex React SDK re-throws backend `ConvexError` as a `ConvexError` instance
 * where `.data` is the structured payload directly (not JSON-encoded like mobile SDKs).
 *
 * Backend throws: `new ConvexError({ code: "SKILL_INCOMPATIBLE", message: "..." })`
 * Client receives: `error.data === { code: "SKILL_INCOMPATIBLE", message: "..." }`
 *
 * For plain `throw new Error(...)` from the backend, Convex strips the message for
 * security — the client only sees a generic "Server Error" string.
 */
export function convexErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ConvexError) {
    const data = error.data;
    // Structured object: { code, message }
    if (data && typeof data === "object" && "message" in data) {
      const msg = (data as { message?: string }).message;
      if (typeof msg === "string" && msg.length > 0) return msg;
    }
    // Bare string payload: new ConvexError("some text")
    if (typeof data === "string" && data.length > 0) return data;
  }
  // Fall through: generic Error or unknown
  if (error instanceof Error && error.message) {
    // Convex ServerError messages are opaque ("Server Error") — not helpful.
    // Only surface non-opaque messages from other Error types.
    const msg = error.message;
    if (!msg.includes("[Request ID:") && msg !== "Server Error") {
      return msg;
    }
  }
  return fallback;
}
