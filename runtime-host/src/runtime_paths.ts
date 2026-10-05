import { homedir } from "node:os";
import { join } from "node:path";

export type RuntimePaths = {
  root: string;
  hostLock: string;
  hostStatus: string;
  eventSpool: string;
  usageHistory: string;
};

export function runtimePaths(
  platform: NodeJS.Platform = process.platform,
  userHome = homedir(),
  environment: NodeJS.ProcessEnv = process.env,
): RuntimePaths {
  const root = platform === "darwin"
    ? join(userHome, "Library", "Application Support", "NanthAI", "Runtime Host")
    : join(environment.XDG_STATE_HOME ?? join(userHome, ".local", "state"), "nanthai");
  return {
    root,
    hostLock: join(root, "host.lock"),
    hostStatus: join(root, "host-status.json"),
    eventSpool: join(root, "outbound-events.json"),
    usageHistory: join(root, "usage-history.json"),
  };
}
