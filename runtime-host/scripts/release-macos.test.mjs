import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { releaseMacosInstaller } from "./release-macos.mjs";

async function fixture(options = {}) {
  const folder = await mkdtemp(join(tmpdir(), "runtime-release-"));
  const appPath = join(folder, "Candidate.app");
  const host = join(appPath, "Contents/Resources/host");
  await mkdir(host, { recursive: true });
  await writeFile(join(host, "manifest.json"), JSON.stringify({
    version: "0.4.4", sourceRevision: options.dirty ? "abc1234-dirty" : "abc1234",
    node: { platform: "darwin", arch: "arm64" },
  }));
  const calls = [];
  const bytes = Buffer.from("verified installer fixture");
  const env = {
    NANTHAI_CODESIGN_IDENTITY: "Developer ID Application: Example (EXAMPLETEAM)",
    NANTHAI_NOTARY_PROFILE: "local-test-profile",
    NANTHAI_CONVEX_PRODUCTION_URL: "https://release-test.convex.cloud",
    NANTHAI_RUNTIME_WEB_URL: options.wrongWebsite ? "https://other.example.com" : "https://example.com",
  };
  const run = (command, args) => {
    calls.push([command, ...args]);
    if (command.endsWith("PlistBuddy")) {
      return {
        "Print :CFBundleShortVersionString": "0.4.4",
        "Print :NanthAIWebURL": "https://example.com",
        "Print :NanthAIControlPlaneURL": "https://release-test.convex.site",
      }[args[1]];
    }
    if (command === "hdiutil" && args[0] === "create") writeFileSync(args.at(-1), bytes);
    if (command === "xcrun" && args[0] === "notarytool") {
      return JSON.stringify({ id: "notarization-test", status: options.rejected ? "Invalid" : "Accepted" });
    }
    if (command === "spctl" && options.gatekeeperFailure) throw new Error("Gatekeeper rejected candidate");
    if (command === "npx" && args.includes("runtime_host/installer_storage:generateInstallerUploadUrl")) {
      return JSON.stringify(options.wrongDeployment
        ? "https://wrong-deployment.convex.cloud/upload"
        : "https://release-test.convex.cloud/upload?token=ephemeral-test-token");
    }
    if (command === "npx" && args.includes("runtime_host/installer_storage:getInstallerUrl")) {
      return JSON.stringify("https://release-test.convex.cloud/api/storage/installer-test");
    }
    return "";
  };
  const fetchImpl = async (url, init) => {
    calls.push(["fetch", url, init?.method ?? "GET"]);
    return init?.method === "POST"
      ? globalThis.Response.json({ storageId: "storage-test" })
      : new globalThis.Response(options.corruptDownload ? "different bytes" : bytes);
  };
  return {
    calls, env, appPath, folder,
    deps: { run, fetchImpl, outputDirectory: join(folder, "output") },
  };
}

const envWrites = calls => calls.filter(call => call[0] === "npx" && call[2] === "env");

test("publication changes the production URL only after notarization and downloaded-byte verification", async () => {
  const f = await fixture();
  try {
    const result = await releaseMacosInstaller({ appPath: f.appPath, publish: true, env: f.env }, f.deps);
    assert.equal(result.convexPublished, true);
    assert.equal(result.version, "0.4.4");
    assert.equal(result.sourceRevision, "abc1234");
    assert.equal(envWrites(f.calls).length, 1);
    const writeIndex = f.calls.findIndex(call => call[0] === "npx" && call[2] === "env");
    assert.ok(f.calls.slice(0, writeIndex).some(call => call[0] === "spctl" && call.at(-1).endsWith("downloaded.dmg")));
    const receipt = await readFile(result.receiptPath, "utf8");
    for (const excluded of [f.env.NANTHAI_NOTARY_PROFILE, f.env.NANTHAI_CODESIGN_IDENTITY, "ephemeral-test-token"]) {
      assert.ok(!receipt.includes(excluded));
    }
  } finally { await rm(f.folder, { recursive: true, force: true }); }
});

for (const [name, options, expected] of [
  ["failed notarization", { rejected: true }, /not accepted/],
  ["Gatekeeper denial", { gatekeeperFailure: true }, /Gatekeeper rejected/],
  ["foreign deployment", { wrongDeployment: true }, /different deployment/],
  ["incorrect website", { wrongWebsite: true }, /intended production website/],
  ["corrupt public download", { corruptDownload: true }, /differs from/],
]) {
  test(`${name} cannot publish the download URL`, async () => {
    const f = await fixture(options);
    try {
      await assert.rejects(releaseMacosInstaller({ appPath: f.appPath, publish: true, env: f.env }, f.deps), expected);
      assert.equal(envWrites(f.calls).length, 0);
      if (!options.corruptDownload) assert.ok(!f.calls.some(call => call[0] === "fetch"));
    } finally { await rm(f.folder, { recursive: true, force: true }); }
  });
}

test("missing local signing configuration and unreviewed candidates stop before signing", async () => {
  for (const dirty of [false, true]) {
    const f = await fixture({ dirty });
    try {
      if (!dirty) delete f.env.NANTHAI_CODESIGN_IDENTITY;
      await assert.rejects(releaseMacosInstaller({ appPath: f.appPath, publish: true, env: f.env }, f.deps), dirty ? /clean, reviewed/ : /Set NANTHAI_CODESIGN_IDENTITY/);
      assert.equal(f.calls.length, 0);
    } finally { await rm(f.folder, { recursive: true, force: true }); }
  }
});

test("local packaging does not upload or change production configuration", async () => {
  const f = await fixture();
  try {
    delete f.env.NANTHAI_CONVEX_PRODUCTION_URL;
    const result = await releaseMacosInstaller({ appPath: f.appPath, env: f.env }, f.deps);
    assert.equal(result.convexPublished, false);
    assert.ok(!f.calls.some(call => ["npx", "fetch"].includes(call[0])));
  } finally { await rm(f.folder, { recursive: true, force: true }); }
});
