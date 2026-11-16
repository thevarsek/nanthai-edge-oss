import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileDrivePickerPage } from "./MobileDrivePickerPage";

const { pickGoogleDriveFiles, redeemRelayHandle } = vi.hoisted(() => ({
  pickGoogleDriveFiles: vi.fn((args: unknown) => {
    void args;
    return new Promise(() => {});
  }),
  redeemRelayHandle: vi.fn(async (args: { relayHandle: string }) => {
    void args;
    return { accessToken: "redeemed_token" };
  }),
}));

vi.mock("@/lib/googleDrivePicker", () => ({
  pickGoogleDriveFiles: (args: unknown) => pickGoogleDriveFiles(args),
}));

vi.mock("convex/react", () => ({
  useAction: () => redeemRelayHandle,
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
    expect(window.location.search).toBe("");
    expect(redeemRelayHandle).not.toHaveBeenCalled();
  });

  it("redeems a single-use relay handle instead of reading a token from the URL", async () => {
    const state = encodedRelayState({
      request_state: "request_state_1",
      relay_handle: "relay_handle_1",
      app_id: "app_1",
      developer_key: "dev_1",
      callback_scheme: "nanthai-edge",
      allow_multiple: true,
    });
    window.history.replaceState(null, "", `/mobile-drive-picker?code=code_1&state=${state}`);

    render(<MobileDrivePickerPage />);

    await waitFor(() => {
      expect(pickGoogleDriveFiles).toHaveBeenCalledWith({
        accessToken: "redeemed_token",
        appId: "app_1",
        developerKey: "dev_1",
        multiselect: true,
      });
    });
    expect(redeemRelayHandle).toHaveBeenCalledTimes(1);
    expect(redeemRelayHandle).toHaveBeenCalledWith({ relayHandle: "relay_handle_1" });
    expect(window.location.search).toBe("");
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
