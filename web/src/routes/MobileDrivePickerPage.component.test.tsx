import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileDrivePickerPage } from "./MobileDrivePickerPage";

const { pickGoogleDriveFiles } = vi.hoisted(() => ({
  pickGoogleDriveFiles: vi.fn((args: unknown) => {
    void args;
    return new Promise(() => {});
  }),
}));

vi.mock("@/lib/googleDrivePicker", () => ({
  pickGoogleDriveFiles: (args: unknown) => pickGoogleDriveFiles(args),
}));

describe("MobileDrivePickerPage", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("uses the OAuth access token from the URL fragment and strips it from history", async () => {
    window.history.replaceState(
      null,
      "",
      "/mobile-drive-picker?access_token=query_token&app_id=app_1&developer_key=dev_1#access_token=fragment_token",
    );

    render(<MobileDrivePickerPage />);

    await waitFor(() => {
      expect(pickGoogleDriveFiles).toHaveBeenCalledWith({
        accessToken: "fragment_token",
        appId: "app_1",
        developerKey: "dev_1",
        multiselect: true,
      });
    });
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?app_id=app_1&developer_key=dev_1");
  });

  it("uses a query-string access token and strips it from history", async () => {
    window.history.replaceState(
      null,
      "",
      "/mobile-drive-picker?access_token=query_token&app_id=app_1&developer_key=dev_1",
    );

    render(<MobileDrivePickerPage />);

    await waitFor(() => {
      expect(pickGoogleDriveFiles).toHaveBeenCalledWith({
        accessToken: "query_token",
        appId: "app_1",
        developerKey: "dev_1",
        multiselect: true,
      });
    });
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?app_id=app_1&developer_key=dev_1");
  });

  it("uses the encoded mobile OAuth relay state and strips it from history", async () => {
    const state = encodedRelayState({
      request_state: "request_state_1",
      access_token: "relay_token",
      app_id: "app_1",
      developer_key: "dev_1",
      callback_scheme: "nanthai-edge",
      allow_multiple: true,
    });
    window.history.replaceState(null, "", `/mobile-drive-picker?code=code_1&state=${state}`);

    render(<MobileDrivePickerPage />);

    await waitFor(() => {
      expect(pickGoogleDriveFiles).toHaveBeenCalledWith({
        accessToken: "relay_token",
        appId: "app_1",
        developerKey: "dev_1",
        multiselect: true,
      });
    });
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?code=code_1");
  });

  it("cancels delayed fallback redirects when the page unmounts", () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/mobile-drive-picker?callback_scheme=nanthai-edge");
    const startingHref = window.location.href;

    const { unmount } = render(<MobileDrivePickerPage />);
    unmount();
    vi.advanceTimersByTime(500);

    expect(window.location.href).toBe(startingHref);
  });
});

function encodedRelayState(payload: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return `onepick.${window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}
