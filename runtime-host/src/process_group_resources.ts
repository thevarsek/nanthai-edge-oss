import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ChildResourceSample } from "./resource_sampler.ts";

const execFileAsync = promisify(execFile);

export type ProcessGroupResourceSupport =
  | { supported: true; mode: "posix_ps_process_group" }
  | { supported: false; mode: "windows_job_object_telemetry_required" };

export function processGroupResourceSupport(
  platform = process.platform,
): ProcessGroupResourceSupport {
  return platform === "win32"
    ? { supported: false, mode: "windows_job_object_telemetry_required" }
    : { supported: true, mode: "posix_ps_process_group" };
}

export async function samplePosixProcessGroup(
  processGroupId: number,
): Promise<ChildResourceSample> {
  const support = processGroupResourceSupport();
  if (!support.supported) {
    return {
      pid: processGroupId,
      rssBytes: null,
      cpuMillis: null,
      descriptorCount: null,
    };
  }
  const [processTable, descriptorCount] = await Promise.all([
    execFileAsync(
      "ps",
      ["-axo", "pid=,pgid=,rss=,time="],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    ),
    sampleDescriptorCount(processGroupId),
  ]);
  return {
    ...parsePosixProcessTable(processTable.stdout, processGroupId),
    descriptorCount,
  };
}

export function parsePosixProcessTable(
  output: string,
  processGroupId: number,
): ChildResourceSample {
  let rssKilobytes = 0;
  let cpuMillis = 0;
  let matches = 0;
  for (const line of output.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    if (match === null || Number(match[2]) !== processGroupId) continue;
    const rss = Number(match[3]);
    const cpu = parseCpuTime(match[4] ?? "");
    if (!Number.isFinite(rss) || cpu === null) continue;
    rssKilobytes += rss;
    cpuMillis += cpu;
    matches += 1;
  }
  return {
    pid: processGroupId,
    rssBytes: matches === 0 ? null : rssKilobytes * 1_024,
    cpuMillis: matches === 0 ? null : cpuMillis,
    descriptorCount: null,
  };
}

export function parseLsofDescriptorCount(output: string): number {
  return output.split("\n").filter((line) => line.startsWith("f")).length;
}

async function sampleDescriptorCount(processGroupId: number): Promise<number | null> {
  return sampleLsofDescriptors(["-a", "-g", String(processGroupId), "-F", "pf"]);
}

async function sampleLsofDescriptors(args: string[]): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      "lsof",
      args,
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    );
    return parseLsofDescriptorCount(stdout);
  } catch (error) {
    if (isMissingCommand(error) || isNoMatches(error)) return null;
    throw error;
  }
}

function isMissingCommand(error: unknown): boolean {
  return error instanceof Error && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function isNoMatches(error: unknown): boolean {
  return error instanceof Error && "code" in error
    && (error as { code?: number }).code === 1;
}

function parseCpuTime(value: string): number | null {
  const daySplit = value.trim().split("-");
  if (daySplit.length > 2) return null;
  const days = daySplit.length === 2 ? Number(daySplit[0]) : 0;
  const time = daySplit.at(-1)?.split(":") ?? [];
  if (time.length < 2 || time.length > 3 || !Number.isFinite(days)) return null;
  const seconds = Number(time.at(-1));
  const minutes = Number(time.at(-2));
  const hours = time.length === 3 ? Number(time[0]) : 0;
  if (![hours, minutes, seconds].every(Number.isFinite)) return null;
  return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1_000;
}
