import { describe, expect, it } from "vitest";
import {
  analyticsErrorCategory,
  analyticsRouteTemplate,
  buildAnalyticsExceptionDiagnostic,
} from "./analyticsException";

describe("analyticsException", () => {
  it("keeps useful frames while removing raw messages, URL secrets, and local usernames", () => {
    const error = new TypeError("prompt text with token=secret");
    error.stack = [
      "TypeError: prompt text with token=secret",
      "    at renderWidget (https://nanthai.tech/assets/app.js?token=secret:10:2)",
      "    at loadFile (/Users/private-user/project/source.ts:20:4)",
    ].join("\n");

    const diagnostic = buildAnalyticsExceptionDiagnostic(error, {
      boundaryLevel: "app",
      featureArea: "error_boundary",
      hasComponentStack: true,
      operation: "react_render",
      route: "/app/chat/jd73zhf2n0f0rqkybj0g5mzqjn8a79js?secret=value",
    });

    expect(diagnostic.error).toMatchObject({
      message: "react_render.type_error",
      name: "TypeError",
    });
    expect(diagnostic.error.stack).toContain("at renderWidget (https://nanthai.tech/assets/app.js");
    expect(diagnostic.error.stack).toContain("/Users/[redacted]/project/source.ts");
    expect(diagnostic.properties).toMatchObject({
      boundary_level: "app",
      error_category: "type_error",
      error_label: "type_error",
      error_message_redacted: true,
      error_type: "TypeError",
      feature_area: "error_boundary",
      has_component_stack: true,
      operation: "react_render",
      route_template: "/app/chat/:id",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("prompt text");
    expect(JSON.stringify(diagnostic)).not.toContain("token=secret");
    expect(JSON.stringify(diagnostic)).not.toContain("private-user");
  });

  it("captures only allow-listed codes and valid HTTP statuses", () => {
    const rateLimitError = Object.assign(new Error("raw response"), {
      code: "TOO_MANY_REQUESTS",
      response: { status: 429 },
    });
    const diagnostic = buildAnalyticsExceptionDiagnostic(rateLimitError);

    expect(analyticsErrorCategory(rateLimitError)).toBe("rate_limited");
    expect(diagnostic.properties).toMatchObject({
      error_code: "TOO_MANY_REQUESTS",
      http_status: 429,
    });
  });

  it("drops arbitrary codes instead of treating them as safe diagnostics", () => {
    const error = Object.assign(new Error("hidden"), {
      code: "secret-token-fragment",
      status: 200,
    });
    const diagnostic = buildAnalyticsExceptionDiagnostic(error);

    expect(diagnostic.properties).not.toHaveProperty("error_code");
    expect(diagnostic.properties).not.toHaveProperty("http_status");
    expect(JSON.stringify(diagnostic)).not.toContain("secret-token-fragment");
  });

  it("templates only identifiers while preserving useful route names", () => {
    expect(analyticsRouteTemplate("/features/price-transparency?campaign=private")).toBe(
      "/features/price-transparency",
    );
    expect(analyticsRouteTemplate("/app/chat/550e8400-e29b-41d4-a716-446655440000")).toBe(
      "/app/chat/:id",
    );
  });
});
