export function safeCallbackScheme(value: string | null): string {
  return value === "nanthai-edge" ? value : "nanthai-edge";
}

export function callbackUrl(callbackScheme: string, fileIds: string[], state?: string | null): string {
  const params = new URLSearchParams();
  params.set("fileIds", fileIds.join(","));
  if (state) params.set("state", state);
  return `${callbackScheme}://drive-picker?${params.toString()}`;
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
