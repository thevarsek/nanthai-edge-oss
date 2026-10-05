import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("packaged launcher provides bundled Node to native tool shebangs under GUI PATH", async () => {
  const stage = await mkdtemp(join(tmpdir(), "nanthai package "));
  try {
    await mkdir(join(stage, "runtime"));
    await mkdir(join(stage, "app"));
    await symlink(process.execPath, join(stage, "runtime/node"));
    await copyFile(new URL("../packaging/nanthai", import.meta.url), join(stage, "nanthai"));
    await writeFile(join(stage, "native-tool"), "#!/usr/bin/env node\nconsole.log(process.versions.node);\n");
    await chmod(join(stage, "native-tool"), 0o755);
    await writeFile(join(stage, "app/cli_entry.mjs"), `
      import { execFileSync } from 'node:child_process';
      import { fileURLToPath } from 'node:url';
      const tool = fileURLToPath(new URL('../native-tool', import.meta.url));
      console.log(execFileSync(tool, [], {encoding:'utf8'}).trim());
    `);
    const version = execFileSync("/bin/sh", [join(stage, "nanthai")], {
      env: { PATH: "/usr/bin:/bin" }, encoding: "utf8",
    }).trim();
    assert.equal(version, process.versions.node);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
});
