import { expect, test } from "vitest";

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

  expect(pickedFileIds(params)).toEqual(["a", "b", "c", "d", "e"]);
});

test("callbackUrl preserves state for success and cancel callbacks", () => {
  expect(
    callbackUrl("nanthai-edge", ["file_1", "file_2"], "state_1"),
  ).toBe("nanthai-edge://drive-picker?fileIds=file_1%2Cfile_2&state=state_1");
  expect(
    callbackUrl("nanthai-edge", [], "state_1"),
  ).toBe("nanthai-edge://drive-picker?fileIds=&state=state_1");
});

test("safeCallbackScheme allowlists the native callback scheme", () => {
  expect(safeCallbackScheme("nanthai-edge")).toBe("nanthai-edge");
  expect(safeCallbackScheme("https")).toBe("nanthai-edge");
  expect(safeCallbackScheme(null)).toBe("nanthai-edge");
});

test("androidIntentCallbackUrl targets the native Android package", () => {
  expect(
    androidIntentCallbackUrl("nanthai-edge", ["file_1"], "state_1"),
  ).toBe("intent://drive-picker?fileIds=file_1&state=state_1#Intent;scheme=nanthai-edge;package=com.nanthai.edge;end");
});
