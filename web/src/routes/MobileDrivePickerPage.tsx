import { useEffect, useMemo, useState } from "react";
import { pickGoogleDriveFiles } from "@/lib/googleDrivePicker";
import {
  androidIntentCallbackUrl,
  callbackUrl,
  decodeDrivePickerRelayState,
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

function sanitizedMobilePickerUrl(pathname: string, search: string, stripRelayState = false): string {
  const params = new URLSearchParams(search);
  params.delete("access_token");
  if (stripRelayState) params.delete("state");
  const nextSearch = params.toString();
  return `${pathname}${nextSearch ? `?${nextSearch}` : ""}`;
}

function redirectToCallback(callbackScheme: string, fileIds: string[], state?: string | null, code?: string | null) {
  const isAndroid = /Android/i.test(window.navigator.userAgent);
  window.location.href = isAndroid
    ? androidIntentCallbackUrl(callbackScheme, fileIds, state, code)
    : callbackUrl(callbackScheme, fileIds, state, code);
}

export function MobileDrivePickerPage() {
  const [message, setMessage] = useState("Opening Google Drive...");
  const config = useMemo(() => {
    const query = readQueryParams();
    const params = readFragmentParams();
    const rawState = query.get("state") ?? params.get("state");
    const relayState = decodeDrivePickerRelayState(rawState);
    const callbackScheme = safeCallbackScheme(
      query.get("callback_scheme") ?? params.get("callback_scheme") ?? relayState?.callbackScheme ?? null,
    );
    const queryFileIds = pickedFileIds(query);
    const selectedFileIds = queryFileIds.length > 0 ? queryFileIds : pickedFileIds(params);
    const accessToken = params.get("access_token") ?? query.get("access_token") ?? relayState?.accessToken ?? "";
    if (params.has("access_token") || query.has("access_token") || relayState) {
      window.history.replaceState(
        null,
        "",
        sanitizedMobilePickerUrl(window.location.pathname, window.location.search, Boolean(relayState)),
      );
    }
    return {
      accessToken,
      appId: firstNonEmpty(params.get("app_id"), query.get("app_id"), relayState?.appId, googlePickerAppId()),
      developerKey: firstNonEmpty(
        params.get("developer_key"),
        query.get("developer_key"),
        relayState?.developerKey,
        googlePickerDeveloperKey(),
      ),
      callbackScheme,
      selectedFileIds,
      state: relayState?.requestState ?? rawState,
      code: query.get("code") ?? params.get("code"),
      error: query.get("error"),
      multiselect: relayState?.allowMultiple ?? true,
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timeoutIds = new Set<number>();
    const scheduleFallbackRedirect = () => {
      const timeoutId = window.setTimeout(() => {
        timeoutIds.delete(timeoutId);
        if (!cancelled) {
          redirectToCallback(config.callbackScheme, [], config.state);
        }
      }, 500);
      timeoutIds.add(timeoutId);
    };

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
          config.code,
        );
        return;
      }
      if (!config.accessToken || !config.appId || !config.developerKey) {
        setMessage("Google Drive Picker is not configured.");
        scheduleFallbackRedirect();
        return;
      }
      try {
        const picked = await pickGoogleDriveFiles({
          accessToken: config.accessToken,
          appId: config.appId,
          developerKey: config.developerKey,
          multiselect: config.multiselect,
        });
        if (cancelled) return;
        redirectToCallback(config.callbackScheme, picked.map((file) => file.id), config.state, config.code);
      } catch {
        if (!cancelled) {
          setMessage("Failed to open Google Drive Picker.");
          scheduleFallbackRedirect();
        }
      }
    })();
    return () => {
      cancelled = true;
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
      timeoutIds.clear();
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

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  return values.find((value): value is string => Boolean(value)) ?? "";
}
