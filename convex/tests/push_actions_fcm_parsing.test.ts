import assert from "node:assert/strict";
import test from "node:test";

import { extractFirstFcmError, parseFcmResponseBody } from "../push/actions";

test("parseFcmResponseBody parses valid JSON", () => {
  const body = parseFcmResponseBody('{"results":[{"message_id":"1"}]}');
  assert.deepEqual(body, {
    results: [{ message_id: "1" }],
  });
});

test("parseFcmResponseBody returns null for invalid JSON", () => {
  const body = parseFcmResponseBody("not-json");
  assert.equal(body, null);
});

test("parseFcmResponseBody preserves non-object JSON values for call-site validation", () => {
  const body = parseFcmResponseBody('[{"error":"NotRegistered"}]');
  assert.deepEqual(body, [{ error: "NotRegistered" }]);
});

test("parseFcmResponseBody preserves object with malformed results for runtime validation", () => {
  const body = parseFcmResponseBody('{"results":"not-an-array"}');
  assert.deepEqual(body, { results: "not-an-array" });
});

test("extractFirstFcmError returns null when response body is not an object", () => {
  assert.equal(extractFirstFcmError(null), null);
  assert.equal(extractFirstFcmError([]), null);
  assert.equal(extractFirstFcmError("text"), null);
});

test("extractFirstFcmError returns null when results is missing, empty, or malformed", () => {
  assert.equal(extractFirstFcmError({}), null);
  assert.equal(extractFirstFcmError({ results: [] }), null);
  assert.equal(extractFirstFcmError({ results: "bad-shape" }), null);
  assert.equal(extractFirstFcmError({ results: [null] }), null);
});

test("extractFirstFcmError returns null when first result has non-string error", () => {
  assert.equal(extractFirstFcmError({ results: [{ error: { code: "NotRegistered" } }] }), null);
  assert.equal(extractFirstFcmError({ results: [{ error: 42 }] }), null);
});

test("extractFirstFcmError returns empty string when first result has no error", () => {
  assert.equal(extractFirstFcmError({ results: [{ message_id: "ok" }] }), "");
});

test("extractFirstFcmError returns first result error string for delivery failures", () => {
  assert.equal(
    extractFirstFcmError({ results: [{ error: "MismatchSenderId" }] }),
    "MismatchSenderId",
  );
  assert.equal(
    extractFirstFcmError({ results: [{ error: "NotRegistered" }] }),
    "NotRegistered",
  );
  assert.equal(
    extractFirstFcmError({ results: [{ error: "InvalidRegistration" }] }),
    "InvalidRegistration",
  );
});
