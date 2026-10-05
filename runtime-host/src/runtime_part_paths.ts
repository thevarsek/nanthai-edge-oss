import { join } from "node:path";

import type { RuntimeContentPart } from "./protocol.ts";

type FetchedRuntimePart = Exclude<RuntimeContentPart, { type: "text" }>;

export function runtimePartPath(directory: string, part: FetchedRuntimePart): string {
  return join(directory, `${part.fetch.sha256}.${mimeSuffix(part.mimeType)}`);
}

function mimeSuffix(mimeType: string): string {
  const subtype = mimeType.slice(mimeType.indexOf("/") + 1).toLowerCase();
  if (subtype === "jpeg") return "jpg";
  if (subtype === "svg+xml") return "svg";
  const safe = subtype.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return safe.length === 0 ? "bin" : safe.slice(0, 32);
}
