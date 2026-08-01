"use node";

import { createHash } from "node:crypto";

export function mcpOperationInputHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
