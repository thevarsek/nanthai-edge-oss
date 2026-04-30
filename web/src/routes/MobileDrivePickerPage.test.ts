import assert from "node:assert/strict";
import test from "node:test";

import {
  androidIntentCallbackUrl,
  callbackUrl,
  pickedFileIds,
  safeCallbackScheme,
} from "./MobileDrivePickerPage.helpers";

test("pickedFileIds accepts all callback key variants and trims blanks", () => {
  const params = new URLSearchParams();
  params.append("picked_file_ids", "a, b,");
  params.append("pickedFileIds", "c");
  params.append("file_ids", " d ");
  params.append("fileIds", ",e,,");

  assert.deepEqual(pickedFileIds(params), ["a", "b", "c", "d", "e"]);
});

test("callbackUrl preserves state for success and cancel callbacks", () => {
  assert.equal(
    callbackUrl("nanthai-edge", ["file_1", "file_2"], "state_1"),
    "nanthai-edge://drive-picker?fileIds=file_1%2Cfile_2&state=state_1",
  );
  assert.equal(
    callbackUrl("nanthai-edge", [], "state_1"),
    "nanthai-edge://drive-picker?fileIds=&state=state_1",
  );
});

test("safeCallbackScheme allowlists the native callback scheme", () => {
  assert.equal(safeCallbackScheme("nanthai-edge"), "nanthai-edge");
  assert.equal(safeCallbackScheme("https"), "nanthai-edge");
  assert.equal(safeCallbackScheme(null), "nanthai-edge");
});

test("androidIntentCallbackUrl targets the native Android package", () => {
  assert.equal(
    androidIntentCallbackUrl("nanthai-edge", ["file_1"], "state_1"),
    "intent://drive-picker?fileIds=file_1&state=state_1#Intent;scheme=nanthai-edge;package=com.nanthai.edge;end",
  );
});
