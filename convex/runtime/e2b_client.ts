"use node";

import { Sandbox } from "@e2b/code-interpreter";
import {
  RUNTIME_TEMPLATE_NAME,
  RUNTIME_TIMEOUT_MS,
} from "./shared";

export function assertE2BConfigured(): void {
  if (!process.env.E2B_API_KEY?.trim()) {
    throw new Error("E2B_API_KEY is not configured for runtime sandboxes.");
  }
}

export async function createE2BSandbox(metadata: Record<string, string>) {
  assertE2BConfigured();
  return await Sandbox.create(RUNTIME_TEMPLATE_NAME, {
    timeoutMs: RUNTIME_TIMEOUT_MS,
    secure: true,
    allowInternetAccess: true,
    metadata,
    lifecycle: {
      onTimeout: "pause",
      autoResume: false,
    },
  });
}

export async function connectE2BSandbox(sandboxId: string) {
  assertE2BConfigured();
  return await Sandbox.connect(sandboxId, {
    timeoutMs: RUNTIME_TIMEOUT_MS,
  });
}

export async function killE2BSandbox(sandboxId: string): Promise<void> {
  assertE2BConfigured();
  const sandbox = await Sandbox.connect(sandboxId, {
    timeoutMs: RUNTIME_TIMEOUT_MS,
  });
  await sandbox.kill();
}
