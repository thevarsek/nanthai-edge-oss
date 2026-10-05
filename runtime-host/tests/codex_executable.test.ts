import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveCodexCommand, verifyCodexVersion } from "../src/codex_executable.ts";

test("executable selection is explicit and reports path repair without scanning installations", async () => {
  await assert.rejects(resolveCodexCommand({}), /NANTHAI_CODEX_COMMAND/);
  await assert.rejects(resolveCodexCommand({ NANTHAI_CODEX_COMMAND: "codex" }), /absolute path/);
  await assert.rejects(resolveCodexCommand({ NANTHAI_CODEX_COMMAND: "/nonexistent/nanthai-codex" }), /Update NANTHAI_CODEX_COMMAND/);
});

test("resolves an executable symlink with spaces and rejects a non-executable selection", async () => {
  const root = await mkdtemp(join(tmpdir(), "nanthai-executable-"));
  try {
    const command = join(root, "selected codex");
    const link = join(root, "codex link");
    await writeFile(command, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    await symlink(command, link);
    const resolved = await resolveCodexCommand({ NANTHAI_CODEX_COMMAND: link });
    assert.ok(resolved.endsWith("/selected codex"));
    await chmod(command, 0o600);
    await assert.rejects(resolveCodexCommand({ NANTHAI_CODEX_COMMAND: command }), /unavailable/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verifies the reported version before account inspection without invoking a shell", async () => {
  const root = await mkdtemp(join(tmpdir(), "nanthai-version-"));
  try {
    const fixture = join(root, "version.mjs");
    await writeFile(fixture, 'process.stdout.write("codex-cli 0.153.4\\n")');
    assert.equal(await verifyCodexVersion(process.execPath, [fixture]), "0.153.4");
    await writeFile(fixture, 'process.stdout.write("codex-cli 0.148.0\\n")');
    await assert.rejects(verifyCodexVersion(process.execPath, [fixture]), /reports 0.148.0/);
    await writeFile(fixture, 'process.stdout.write("codex-cli 0.154.0\\n")');
    assert.equal(await verifyCodexVersion(process.execPath, [fixture]), "0.154.0");
    await writeFile(fixture, 'process.stdout.write("codex-cli 0.159.0-alpha.12.1\\n")');
    assert.equal(await verifyCodexVersion(process.execPath, [fixture]), "0.159.0-alpha.12.1");
    await writeFile(fixture, 'process.stdout.write("codex-cli 0.159.2+build.1\\n")');
    assert.equal(await verifyCodexVersion(process.execPath, [fixture]), "0.159.2+build.1");
    await writeFile(fixture, 'process.stdout.write("unrecognized output\\n")');
    await assert.rejects(verifyCodexVersion(process.execPath, [fixture]), /unrecognized version/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
