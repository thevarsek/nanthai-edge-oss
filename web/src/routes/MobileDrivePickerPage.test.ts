import { expect, test } from "vitest";

import {
  androidIntentCallbackUrl,
  callbackUrl,
  decodeDrivePickerRelayState,
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
    callbackUrl("nanthai-edge", ["file_1", "file_2"], "state_1", "code_1"),
  ).toBe("nanthai-edge://drive-picker?fileIds=file_1%2Cfile_2&state=state_1&code=code_1");
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
    androidIntentCallbackUrl("nanthai-edge", ["file_1"], "state_1", "code_1"),
  ).toBe("intent://drive-picker?fileIds=file_1&state=state_1&code=code_1#Intent;scheme=nanthai-edge;package=com.nanthai.edge;end");
});

test("decodeDrivePickerRelayState reads the encoded mobile OAuth relay payload", () => {
  const state = encodedRelayState({
    request_state: "state_1",
    access_token: "token_1",
    app_id: "app_1",
    developer_key: "dev_1",
    callback_scheme: "nanthai-edge",
    allow_multiple: true,
  });

  expect(decodeDrivePickerRelayState(state)).toEqual({
    requestState: "state_1",
    accessToken: "token_1",
    appId: "app_1",
    developerKey: "dev_1",
    callbackScheme: "nanthai-edge",
    allowMultiple: true,
  });
  expect(decodeDrivePickerRelayState("state_1")).toBeNull();
});

function encodedRelayState(payload: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return `onepick.${window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}
