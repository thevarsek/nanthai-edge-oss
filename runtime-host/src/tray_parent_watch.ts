export function watchTrayParent(
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
  shutdown: AbortController,
  exists: (pid: number) => boolean = processExists,
  intervalMs = 2_000,
): (() => void) {
  const ownerIndex = args.indexOf("--owner");
  const pid = Number(environment.NANTHAI_TRAY_PARENT_PID);
  if (ownerIndex < 0 || args[ownerIndex + 1] !== "tray" || !Number.isSafeInteger(pid) || pid <= 1) return () => {};
  const timer = setInterval(() => { if (!exists(pid)) shutdown.abort(); }, intervalMs);
  timer.unref();
  const stop = () => clearInterval(timer);
  shutdown.signal.addEventListener("abort", stop, { once: true });
  return stop;
}

function processExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
    return true;
  }
}
