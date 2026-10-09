import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";
import { imageFailureAnalytics, imageFailureDiagnostics } from "../lib/openrouter_image_diagnostics";
import { callOpenRouterImage } from "../lib/openrouter_image";

test("image diagnostics retain recognized parameter failures and never free text or references", async () => {
  const payload = { error: { message: "SECRET prompt", metadata: { raw: JSON.stringify({ error: { code: "invalid_parameter", param: "resolution", message: "SECRET token" } }) } } };
  const request = { model: "recraft/recraft-v4", prompt: "SECRET prompt", resolution: "4K", size: "1024x1024", inputReferences: [{ type: "image_url" as const, image_url: { url: "https://example.com/SECRET" } }] };
  const diagnostics = imageFailureDiagnostics(400, payload, request);
  assert.equal(diagnostics.provider_error_code, "invalid_parameter");
  assert.equal(diagnostics.provider_error_parameter, "resolution");
  assert.equal(diagnostics.image_request_resolution, "4K");
  assert.equal(diagnostics.image_request_size, undefined);
  assert.equal(diagnostics.image_request_reference_count, 1);
  assert.doesNotMatch(JSON.stringify(diagnostics), /SECRET/);
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const logs: unknown[] = [];
  let attempts = 0;
  try {
    console.warn = (...args: unknown[]) => { logs.push(args); };
    globalThis.fetch = async () => { attempts++; return new Response(JSON.stringify(payload), { status: 400 }); };
    await assert.rejects(callOpenRouterImage("SECRET key", request), error => {
      assert.ok(error instanceof ConvexError);
      assert.equal(error.data.diagnostics.provider_error_parameter, "resolution");
      assert.deepEqual(imageFailureAnalytics(error), { provider_http_status: 400, provider_error_code: "invalid_parameter", provider_error_parameter: "resolution" });
      assert.doesNotMatch(JSON.stringify(error.data), /SECRET|reconnect/i);
      return true;
    });
    assert.equal(attempts, 1);
    assert.doesNotMatch(JSON.stringify(logs), /SECRET/);
  } finally { globalThis.fetch = originalFetch; console.warn = originalWarn; }
});
test("untrusted structured fields and malformed/raw errors cannot bypass diagnostic sanitization", () => {
  for (const payload of ["SECRET", { error: { code: "SECRET", param: "SECRET", metadata: { raw: "SECRET" } } }]) {
    const d = imageFailureDiagnostics(400, payload, { model: "SECRET", prompt: "SECRET", quality: "SECRET" });
    assert.equal(d.provider_error_code, "unclassified");
    assert.equal(d.image_request_quality, "unrecognized");
    assert.doesNotMatch(JSON.stringify(d), /SECRET/);
  }
  assert.deepEqual(imageFailureAnalytics(new ConvexError({ diagnostics: { provider_error_code: "SECRET", provider_error_parameter: "SECRET", provider_http_status: 999, raw: "SECRET" } })), {});
});
