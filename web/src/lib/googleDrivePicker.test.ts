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

  it("retries with a fresh script after the Google API script fails", async () => {
    const { loadGoogleDrivePicker } = await import("./googleDrivePicker");

    const firstLoad = loadGoogleDrivePicker();
    const firstScript = document.querySelector<HTMLScriptElement>('script[src="https://apis.google.com/js/api.js"]');
    expect(firstScript).not.toBeNull();
    firstScript?.dispatchEvent(new Event("error"));

    await expect(firstLoad).rejects.toThrow("Failed to load Google Picker.");
    expect(document.querySelectorAll('script[src="https://apis.google.com/js/api.js"]')).toHaveLength(0);

    const secondLoad = loadGoogleDrivePicker();
    const secondScript = document.querySelector<HTMLScriptElement>('script[src="https://apis.google.com/js/api.js"]');
    expect(secondScript).not.toBeNull();
    expect(secondScript).not.toBe(firstScript);
    window.gapi = {
      load: vi.fn((_name, config) => {
        if (typeof config === "object") {
          config.callback?.();
        }
      }),
    };
    secondScript?.dispatchEvent(new Event("load"));

    await expect(secondLoad).resolves.toBeUndefined();
    expect(window.gapi.load).toHaveBeenCalledWith("picker", expect.objectContaining({
      timeout: 15_000,
    }));
  });
});
