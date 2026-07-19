import assert from "node:assert/strict";
import test from "node:test";
import { normalize } from "../analytics_workflows/normalize_action";
import {
  boundAnalyticsEnvelope,
  deserializeAnalyticsEnvelope,
  serializeAnalyticsEnvelope,
} from "../runtime/analytics_execution_envelope";
import {
  ANALYTICS_ARTIFACT_MAX_BYTES,
  ANALYTICS_ARTIFACT_TOTAL_MAX_BYTES,
  ANALYTICS_PARENT_RESULT_MAX_BYTES,
  ANALYTICS_STDERR_MAX_CHARS,
  ANALYTICS_STDOUT_MAX_CHARS,
  ANALYTICS_WARNING_MAX_COUNT,
} from "../analytics_workflows/limits";
import {
  buildInlineParentResult,
  buildStorageBackedParentResult,
  truncateUtf8,
  utf8ByteLength,
} from "../analytics_workflows/normalized_parent_result";
import { createMockCtx } from "../../test_helpers/convex_mock_ctx";

test("analytics execution envelopes keep binaries outside Workflow state without losing bytes", () => {
  const raw = serializeAnalyticsEnvelope({
    stdout: ["42"],
    stderr: [],
    error: null,
    importedFiles: [{ filename: "input.csv" }],
    warnings: [],
    charts: [{ index: 0, pngBytes: new Uint8Array([137, 80, 78, 71]) }],
    outputFiles: [{
      path: "/tmp/outputs/result.csv",
      mimeType: "text/csv",
      bytes: new Uint8Array([97, 44, 98]),
    }],
  });
  const restored = deserializeAnalyticsEnvelope(raw);
  assert.deepEqual(Array.from(restored.charts[0].pngBytes), [137, 80, 78, 71]);
  assert.deepEqual(Array.from(restored.outputFiles[0].bytes), [97, 44, 98]);
});

test("durable analytics bounds text and artifact bytes before persistence", () => {
  const envelope = boundAnalyticsEnvelope({
    stdout: "x".repeat(ANALYTICS_STDOUT_MAX_CHARS + 10_000),
    stderr: "e".repeat(ANALYTICS_STDERR_MAX_CHARS + 10_000),
    error: null,
    importedFiles: [],
    warnings: [],
    charts: [{
      index: 0,
      pngBytes: new Uint8Array(ANALYTICS_ARTIFACT_MAX_BYTES + 1),
    }],
    outputFiles: [{
      path: "/tmp/result.csv",
      mimeType: "text/csv",
      bytes: new Uint8Array([1, 2, 3]),
    }],
  });
  assert.ok(String(envelope.stdout).length <= ANALYTICS_STDOUT_MAX_CHARS + 20);
  assert.ok(String(envelope.stderr).length <= ANALYTICS_STDERR_MAX_CHARS + 20);
  assert.equal(envelope.charts.length, 0);
  assert.equal(envelope.outputFiles.length, 1);
  assert.match(envelope.warnings.join("\n"), /omitted/);
});

test("durable analytics enforces one combined artifact count and always reports omissions", () => {
  const envelope = boundAnalyticsEnvelope({
    stdout: "done",
    stderr: "",
    error: null,
    importedFiles: [],
    warnings: Array.from({ length: ANALYTICS_WARNING_MAX_COUNT }, (_, index) => `warning ${index}`),
    charts: Array.from({ length: 5 }, (_, index) => ({
      index,
      pngBytes: new Uint8Array([index]),
    })),
    outputFiles: Array.from({ length: 10 }, (_, index) => ({
      path: `/tmp/output-${index}.csv`,
      mimeType: "text/csv",
      bytes: new Uint8Array([index]),
    })),
  });
  assert.equal(envelope.charts.length, 5);
  assert.equal(envelope.outputFiles.length, 5);
  assert.equal(envelope.warnings.length, ANALYTICS_WARNING_MAX_COUNT);
  assert.match(envelope.warnings.at(-1) ?? "", /5 artifact\(s\) omitted/);
});

test("durable analytics enforces the combined byte maximum across charts and files", () => {
  const remainder = ANALYTICS_ARTIFACT_TOTAL_MAX_BYTES - (2 * ANALYTICS_ARTIFACT_MAX_BYTES);
  const envelope = boundAnalyticsEnvelope({
    stdout: "",
    stderr: "",
    error: null,
    importedFiles: [],
    warnings: [],
    charts: [{ index: 0, pngBytes: new Uint8Array(ANALYTICS_ARTIFACT_MAX_BYTES) }],
    outputFiles: [
      {
        path: "/tmp/one",
        mimeType: "application/octet-stream",
        bytes: new Uint8Array(ANALYTICS_ARTIFACT_MAX_BYTES),
      },
      { path: "/tmp/two", mimeType: "application/octet-stream", bytes: new Uint8Array(remainder) },
      { path: "/tmp/three", mimeType: "application/octet-stream", bytes: new Uint8Array(1) },
    ],
  });
  assert.equal(envelope.charts.length, 1);
  assert.equal(envelope.outputFiles.length, 2);
  assert.match(envelope.warnings.join("\n"), /1 artifact\(s\) omitted/);
});

test("analytics parent fallback is UTF-8-byte bounded and points to the complete stored result", () => {
  const text = "🧪".repeat(ANALYTICS_PARENT_RESULT_MAX_BYTES);
  const input = {
    text,
    resultsSummary: [text],
    importedFiles: [],
    exportedFiles: [],
    warnings: [],
  };
  const inline = buildInlineParentResult(input);
  assert.ok(inline.overflowJson);
  assert.ok(inline.resultBytes > ANALYTICS_PARENT_RESULT_MAX_BYTES);
  const pointer = buildStorageBackedParentResult(input, "storage_complete_result");
  assert.ok(utf8ByteLength(pointer) <= ANALYTICS_PARENT_RESULT_MAX_BYTES);
  assert.equal(JSON.parse(pointer).resultStorageId, "storage_complete_result");
  assert.equal(truncateUtf8("A🧪B", 5), "A🧪");
  assert.equal(utf8ByteLength(truncateUtf8(text, 101)), 100);
});

test("analytics normalization stores the complete overflow and commits only a bounded pointer", async () => {
  const envelopeRaw = serializeAnalyticsEnvelope({
    stdout: "🧪".repeat(ANALYTICS_STDOUT_MAX_CHARS),
    stderr: "",
    error: null,
    importedFiles: [],
    warnings: [],
    charts: [],
    outputFiles: [],
  });
  const run = {
    _id: "analytics_run_1",
    status: "running",
    executionEnvelopeStorageId: "envelope_storage",
  };
  let queryCount = 0;
  let storedOverflow = "";
  let normalizedArgs: Record<string, unknown> | undefined;
  const ctx = createMockCtx({
    runQuery: async () => {
      queryCount += 1;
      return queryCount === 1 ? run : [];
    },
    runMutation: async (_reference: unknown, args: Record<string, unknown>) => {
      normalizedArgs = args;
      return true;
    },
    storage: {
      get: async () => new Blob([envelopeRaw]),
      getUrl: async () => null,
      store: async (blob: Blob) => {
        storedOverflow = await blob.text();
        return "complete_result_storage";
      },
      delete: async () => assert.fail("adopted overflow must not be deleted"),
    },
  });
  await (normalize as unknown as {
    _handler: (context: unknown, args: unknown) => Promise<null>;
  })._handler(ctx, {
    analyticsRunId: "analytics_run_1",
    claimantId: "analytics-workflow:analytics_run_1",
  });
  assert.ok(utf8ByteLength(storedOverflow) > ANALYTICS_PARENT_RESULT_MAX_BYTES);
  assert.equal(normalizedArgs?.resultStorageId, "complete_result_storage");
  assert.ok(utf8ByteLength(String(normalizedArgs?.resultJson)) <= ANALYTICS_PARENT_RESULT_MAX_BYTES);
  assert.equal(JSON.parse(String(normalizedArgs?.resultJson)).resultStorageId, "complete_result_storage");
  assert.ok(Number(normalizedArgs?.resultBytes) > ANALYTICS_PARENT_RESULT_MAX_BYTES);
});
