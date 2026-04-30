import { useEffect, useMemo, useState } from "react";
import { pickGoogleDriveFiles } from "@/lib/googleDrivePicker";
import {
  androidIntentCallbackUrl,
  callbackUrl,
  pickedFileIds,
  safeCallbackScheme,
} from "./MobileDrivePickerPage.helpers";

function readQueryParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function readFragmentParams(): URLSearchParams {
  const raw = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  return new URLSearchParams(raw);
}

function googlePickerDeveloperKey(): string {
  return import.meta.env.VITE_GOOGLE_PICKER_API_KEY ?? import.meta.env.VITE_GOOGLE_API_KEY ?? "";
}

function googlePickerAppId(): string {
  return import.meta.env.VITE_GOOGLE_PICKER_APP_ID ?? import.meta.env.VITE_GOOGLE_PROJECT_NUMBER ?? "";
}

function redirectToCallback(callbackScheme: string, fileIds: string[], state?: string | null) {
  const isAndroid = /Android/i.test(window.navigator.userAgent);
  window.location.href = isAndroid
    ? androidIntentCallbackUrl(callbackScheme, fileIds, state)
    : callbackUrl(callbackScheme, fileIds, state);
}

export function MobileDrivePickerPage() {
  const [message, setMessage] = useState("Opening Google Drive...");
  const config = useMemo(() => {
    const query = readQueryParams();
    const params = readFragmentParams();
    const callbackScheme = safeCallbackScheme(query.get("callback_scheme") ?? params.get("callback_scheme"));
    const queryFileIds = pickedFileIds(query);
    const selectedFileIds = queryFileIds.length > 0 ? queryFileIds : pickedFileIds(params);
    return {
      accessToken: params.get("access_token") ?? query.get("access_token") ?? "",
      appId: params.get("app_id") ?? query.get("app_id") ?? googlePickerAppId(),
      developerKey: params.get("developer_key") ?? query.get("developer_key") ?? googlePickerDeveloperKey(),
      callbackScheme,
      selectedFileIds,
      state: query.get("state") ?? params.get("state"),
      error: query.get("error"),
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (config.error) {
        redirectToCallback(config.callbackScheme, [], config.state);
        return;
      }
      if (config.selectedFileIds.length > 0) {
        redirectToCallback(
          config.callbackScheme,
          config.selectedFileIds,
          config.state,
        );
        return;
      }
      if (!config.accessToken || !config.appId || !config.developerKey) {
        setMessage("Google Drive Picker is not configured.");
        window.setTimeout(() => redirectToCallback(config.callbackScheme, [], config.state), 500);
        return;
      }
      try {
        const picked = await pickGoogleDriveFiles({
          accessToken: config.accessToken,
          appId: config.appId,
          developerKey: config.developerKey,
          multiselect: true,
        });
        if (cancelled) return;
        redirectToCallback(config.callbackScheme, picked.map((file) => file.id), config.state);
      } catch {
        if (!cancelled) {
          setMessage("Failed to open Google Drive Picker.");
          window.setTimeout(() => redirectToCallback(config.callbackScheme, [], config.state), 500);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config]);

  return (
    <main className="min-h-dvh bg-white text-neutral-950 flex items-center justify-center px-6">
      <div className="text-center">
        <div className="mx-auto mb-6 h-10 w-10 rounded-full border-4 border-neutral-200 border-t-blue-600 animate-spin" />
        <p className="text-base font-medium">{message}</p>
      </div>
    </main>
  );
}
