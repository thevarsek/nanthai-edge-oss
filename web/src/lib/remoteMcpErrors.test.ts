import { describe, expect, it } from "vitest";
import { ConvexError } from "convex/values";
import { remoteMcpErrorMessage } from "./remoteMcpErrors";

const t = ((key: string) => `translated:${key}`) as never;

describe("remoteMcpErrorMessage", () => {
  it("maps stable MCP codes instead of exposing backend English", () => {
    const error = new ConvexError({ code: "MCP_AUTH_REQUIRED", message: "backend English" });
    expect(remoteMcpErrorMessage(error, t, "fallback")).toBe("translated:remote_mcp_error_auth_required");
  });

  it("fails closed to localized operation copy for unknown MCP codes", () => {
    const error = new ConvexError({ code: "MCP_FUTURE_CODE", message: "backend English" });
    expect(remoteMcpErrorMessage(error, t, "localized fallback")).toBe("localized fallback");
  });
});
