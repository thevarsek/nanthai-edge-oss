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
