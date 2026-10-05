import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";
import { CODEX_CLI_PACKAGE_VERSION } from "./runtime_identity.ts";

const executeFile = promisify(execFile);

export async function resolveCodexCommand(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const selected = environment.NANTHAI_CODEX_COMMAND?.trim();
  return resolveRuntimeExecutable(selected, "Codex", "NANTHAI_CODEX_COMMAND");
}

export async function resolveRuntimeExecutable(selected: string | undefined, label: string, variable: string): Promise<string> {
  if (!selected || !isAbsolute(selected)) {
    throw new Error(`Set ${variable} to the absolute path of your installed ${label} executable.`);
  }
  try {
    await access(selected, constants.X_OK);
    const command = await realpath(selected);
    if (!(await stat(command)).isFile()) throw new Error("Not a file");
    return command;
  } catch {
    throw new Error(`The selected ${label} executable is unavailable. Update ${variable} to its current executable path.`);
  }
}

export async function verifyCodexVersion(command: string, args: readonly string[] = []): Promise<string> {
  const { stdout } = await executeFile(command, [...args, "--version"], {
    timeout: 10_000, maxBuffer: 16_384, windowsHide: true,
  });
  const version = /^codex-cli (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\s*$/.exec(stdout.trim())?.[1];
  if (!version || compareVersions(version, CODEX_CLI_PACKAGE_VERSION) < 0) {
    throw new Error(`This preview requires Codex ${CODEX_CLI_PACKAGE_VERSION} or newer; the selected executable reports ${version ?? "an unrecognized version"}. Select a supported executable before starting the host.`);
  }
  return version;
}

function compareVersions(actual: string, minimum: string): number {
  const left = actual.split(/[+-]/, 1)[0]!.split(".").map(Number);
  const right = minimum.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}
