import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout } from "node:timers/promises";
import { watchTrayParent } from "../src/tray_parent_watch.ts";

test("tray loss closes the host through normal shutdown; CLI ownership is independent", async () => {
  const tray = new AbortController(), cli = new AbortController();
  const environment = { NANTHAI_TRAY_PARENT_PID: "123" };
  const stopTray = watchTrayParent(["runtime", "start", "--owner", "tray"], environment, tray, () => false, 1);
  const stopCli = watchTrayParent(["runtime", "start"], environment, cli, () => false, 1);
  try {
    await setTimeout(10);
    assert.equal(tray.signal.aborted, true);
    assert.equal(cli.signal.aborted, false);
  } finally { stopTray(); stopCli(); }
});
