export type PickedDriveFile = {
  id: string;
  name: string;
  mimeType: string;
  url?: string;
};

type PickerDocument = {
  id?: string;
  name?: string;
  mimeType?: string;
  type?: string;
  url?: string;
};

type PickerCallbackData = {
  action: string;
  docs?: PickerDocument[];
};

type PickerBuilderInstance = {
  addView: (view: unknown) => PickerBuilderInstance;
  enableFeature: (feature: unknown) => PickerBuilderInstance;
  setAppId: (appId: string) => PickerBuilderInstance;
  setCallback: (callback: (data: PickerCallbackData) => void) => PickerBuilderInstance;
  setDeveloperKey: (key: string) => PickerBuilderInstance;
  setOAuthToken: (token: string) => PickerBuilderInstance;
  setOrigin?: (origin: string) => PickerBuilderInstance;
  build: () => {
    setVisible: (visible: boolean) => void;
    dispose?: () => void;
  };
};

type GooglePickerApi = {
  Action: { PICKED: string; CANCEL: string };
  DocsView: new (...args: unknown[]) => {
    setIncludeFolders?: (includeFolders: boolean) => unknown;
    setSelectFolderEnabled?: (enabled: boolean) => unknown;
    setMode?: (mode: unknown) => unknown;
  };
  DocsViewMode?: { LIST?: unknown };
  Feature: { MULTISELECT_ENABLED: unknown; SUPPORT_DRIVES?: unknown };
  PickerBuilder: new () => PickerBuilderInstance;
  ViewId: { DOCS: unknown };
};

declare global {
  interface Window {
    google?: { picker?: GooglePickerApi };
    gapi?: {
      load: (
        name: string,
        callbackOrConfig: (() => void) | {
          callback?: () => void;
          onerror?: () => void;
          timeout?: number;
          ontimeout?: () => void;
        },
      ) => void;
    };
  }
}

let pickerLoadPromise: Promise<void> | null = null;

function removeGooglePickerArtifacts() {
  const selectors = [
    'iframe[src*="docs.google.com/picker"]',
    'iframe[src*="picker"]',
    'iframe[src*="accounts.google.com/o/oauth2/iframe"]',
  ];
  for (const iframe of document.querySelectorAll<HTMLIFrameElement>(selectors.join(","))) {
    const parent = iframe.parentElement;
    iframe.remove();
    if (parent && parent.children.length === 0) {
      parent.remove();
    }
  }
}

function loadScript(src: string): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      if (existing.dataset.loaded === "true") resolve();
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Google Picker.")), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error("Failed to load Google Picker."));
    document.head.appendChild(script);
  });
}

export async function loadGoogleDrivePicker(): Promise<void> {
  if (window.google?.picker) return;
  pickerLoadPromise ??= (async () => {
    await loadScript("https://apis.google.com/js/api.js");
    await new Promise<void>((resolve, reject) => {
      if (!window.gapi?.load) {
        reject(new Error("Google API loader is unavailable."));
        return;
      }
      const timeout = window.setTimeout(() => {
        reject(new Error("Timed out loading Google Picker."));
      }, 15_000);
      window.gapi.load("picker", {
        callback: () => {
          window.clearTimeout(timeout);
          resolve();
        },
        onerror: () => {
          window.clearTimeout(timeout);
          reject(new Error("Failed to load Google Picker."));
        },
        ontimeout: () => {
          window.clearTimeout(timeout);
          reject(new Error("Timed out loading Google Picker."));
        },
        timeout: 15_000,
      });
    });
  })().catch((error: unknown) => {
    pickerLoadPromise = null;
    throw error;
  });
  await pickerLoadPromise;
}

export async function pickGoogleDriveFiles(args: {
  accessToken: string;
  appId: string;
  developerKey: string;
  multiselect?: boolean;
}): Promise<PickedDriveFile[]> {
  await loadGoogleDrivePicker();
  const pickerApi = window.google?.picker;
  if (!pickerApi) throw new Error("Google Picker is unavailable.");

  return await new Promise<PickedDriveFile[]>((resolve, reject) => {
    let picker: ReturnType<PickerBuilderInstance["build"]> | null = null;
    let settled = false;

    const cleanup = () => {
      window.removeEventListener("keydown", handleKeyDown);
      try {
        picker?.setVisible(false);
        picker?.dispose?.();
      } catch {
        // Google Picker cleanup is best-effort; callers will surface the error.
      }
      removeGooglePickerArtifacts();
    };

    const finish = (files: PickedDriveFile[]) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(files);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        finish([]);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    const view = new pickerApi.DocsView(pickerApi.ViewId.DOCS);
    view.setIncludeFolders?.(true);
    view.setSelectFolderEnabled?.(false);
    view.setMode?.(pickerApi.DocsViewMode?.LIST);

    const builder = new pickerApi.PickerBuilder()
      .addView(view)
      .setOAuthToken(args.accessToken)
      .setDeveloperKey(args.developerKey)
      .setAppId(args.appId)
      .setCallback((data) => {
        if (data.action === pickerApi.Action.CANCEL) {
          finish([]);
          return;
        }
        if (data.action !== pickerApi.Action.PICKED) return;
        const files = (data.docs ?? [])
          .filter((doc): doc is Required<Pick<PickerDocument, "id" | "name">> & PickerDocument =>
            typeof doc.id === "string" && typeof doc.name === "string",
          )
          .map((doc) => ({
            id: doc.id,
            name: doc.name,
            mimeType: doc.mimeType ?? doc.type ?? "application/octet-stream",
            url: doc.url,
          }));
        finish(files);
      });
    builder.setOrigin?.(window.location.origin);

    if (args.multiselect !== false) {
      builder.enableFeature(pickerApi.Feature.MULTISELECT_ENABLED);
    }
    if (pickerApi.Feature.SUPPORT_DRIVES) {
      builder.enableFeature(pickerApi.Feature.SUPPORT_DRIVES);
    }

    try {
      picker = builder.build();
      picker.setVisible(true);
    } catch (error) {
      fail(error instanceof Error ? error : new Error("Failed to open Google Drive Picker."));
    }
  });
}
