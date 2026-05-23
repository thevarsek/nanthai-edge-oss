import { afterEach, describe, expect, it, vi } from "vitest";

describe("loadGoogleDrivePicker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    document.head.innerHTML = "";
    delete window.gapi;
    delete window.google;
  });

  it("uses an existing Google API script once the loader is already available", async () => {
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    document.head.appendChild(script);

    window.gapi = {
      load: vi.fn((_name, config) => {
        if (typeof config === "object") {
          config.callback?.();
        }
      }),
    };

    const { loadGoogleDrivePicker } = await import("./googleDrivePicker");
    await expect(loadGoogleDrivePicker()).resolves.toBeUndefined();

    expect(window.gapi.load).toHaveBeenCalledWith("picker", expect.objectContaining({
      timeout: 15_000,
    }));
    expect(document.querySelectorAll('script[src="https://apis.google.com/js/api.js"]')).toHaveLength(1);
  });
});
