import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { convexErrorData, convexErrorMessage } from "./convexErrors";

describe("convexErrors", () => {
  it("extracts structured ConvexError messages and data for user-facing failures", () => {
    const error = new ConvexError({
      code: "SKILL_INCOMPATIBLE",
      message: "This skill cannot run with the selected provider.",
    });

    expect(convexErrorMessage(error, "Fallback")).toBe("This skill cannot run with the selected provider.");
    expect(convexErrorData(error)).toEqual({
      code: "SKILL_INCOMPATIBLE",
      message: "This skill cannot run with the selected provider.",
    });
  });

  it("surfaces non-opaque local errors but hides generic Convex server errors", () => {
    expect(convexErrorMessage(new Error("Network offline"), "Fallback")).toBe("Network offline");
    expect(convexErrorMessage(new Error("Server Error"), "Fallback")).toBe("Fallback");
    expect(convexErrorMessage(new Error("Server Error [Request ID: abc]"), "Fallback")).toBe("Fallback");
  });

  it("falls back for empty payloads and preserves Convex stringified object errors", () => {
    expect(convexErrorMessage(new ConvexError(""), "Fallback")).toBe("Fallback");
    expect(convexErrorMessage(new ConvexError({ code: "BAD" }), "Fallback")).toBe("{\"code\":\"BAD\"}");
    expect(convexErrorData(new Error("plain"))).toBeUndefined();
  });
});
