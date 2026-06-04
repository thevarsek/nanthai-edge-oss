const relayStatePrefix = "onepick.";

export interface DrivePickerRelayState {
  requestState: string;
  accessToken: string;
  appId?: string;
  developerKey?: string;
  callbackScheme?: string;
  allowMultiple?: boolean;
}

export function safeCallbackScheme(value: string | null): string {
  return value === "nanthai-edge" ? value : "nanthai-edge";
}

export function callbackUrl(callbackScheme: string, fileIds: string[], state?: string | null, code?: string | null): string {
  const params = new URLSearchParams();
  params.set("fileIds", fileIds.join(","));
  if (state) params.set("state", state);
  if (code) params.set("code", code);
  return `${callbackScheme}://drive-picker?${params.toString()}`;
}

export function androidIntentCallbackUrl(
  callbackScheme: string,
  fileIds: string[],
  state?: string | null,
  code?: string | null,
  packageName = "com.nanthai.edge",
): string {
  const params = new URLSearchParams();
  params.set("fileIds", fileIds.join(","));
  if (state) params.set("state", state);
  if (code) params.set("code", code);
  return `intent://drive-picker?${params.toString()}#Intent;scheme=${callbackScheme};package=${packageName};end`;
}

export function pickedFileIds(params: URLSearchParams): string[] {
  const values = [
    ...params.getAll("picked_file_ids"),
    ...params.getAll("pickedFileIds"),
    ...params.getAll("file_ids"),
    ...params.getAll("fileIds"),
  ];
  return values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

export function decodeDrivePickerRelayState(value: string | null): DrivePickerRelayState | null {
  if (!value?.startsWith(relayStatePrefix)) return null;

  try {
    const encoded = value.slice(relayStatePrefix.length);
    const json = decodeBase64Url(encoded);
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return null;
    const payload = parsed as Record<string, unknown>;
    const requestState = stringValue(payload.request_state);
    const accessToken = stringValue(payload.access_token);
    if (!requestState || !accessToken) return null;
    return {
      requestState,
      accessToken,
      appId: stringValue(payload.app_id),
      developerKey: stringValue(payload.developer_key),
      callbackScheme: stringValue(payload.callback_scheme),
      allowMultiple: typeof payload.allow_multiple === "boolean" ? payload.allow_multiple : undefined,
    };
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string): string {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  const binary = window.atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
