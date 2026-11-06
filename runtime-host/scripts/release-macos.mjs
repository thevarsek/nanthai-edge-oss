import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

function required(env, key) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Set ${key} in your local shell; credentials remain in Keychain.`);
  return value;
}

function httpsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Release URLs must use HTTPS without embedded credentials.");
  return url;
}

function deploymentUrl(value, expectedOrigin) {
  const url = httpsUrl(value);
  if (url.origin !== expectedOrigin) throw new Error("Installer URL belongs to a different deployment.");
  return url.href;
}

export async function releaseMacosInstaller({ appPath, publish = false, env = process.env }, {
  run = (command, args) => execFileSync(command, args, {
    cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"],
  }).trim(),
  fetchImpl = globalThis.fetch,
  outputDirectory = join(root, "runtime-host/dist"),
} = {}) {
  const identity = required(env, "NANTHAI_CODESIGN_IDENTITY");
  const profile = required(env, "NANTHAI_NOTARY_PROFILE");
  if (!identity.startsWith("Developer ID Application:")) throw new Error("A Developer ID Application signing identity is required.");
  const source = resolve(appPath);
  const manifest = JSON.parse(await readFile(join(source, "Contents/Resources/host/manifest.json"), "utf8"));
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("Invalid Runtime Host package version.");
  if (typeof manifest.sourceRevision !== "string" || !manifest.sourceRevision || manifest.sourceRevision.endsWith("-dirty")) throw new Error("Build the release candidate from a clean, reviewed checkout.");
  if (manifest.node?.platform !== "darwin" || !["arm64", "x64"].includes(manifest.node.arch)) throw new Error("The candidate must bundle a supported macOS Node runtime.");
  const plist = join(source, "Contents/Info.plist");
  const plistValue = key => run("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plist]);
  if (plistValue("CFBundleShortVersionString") !== manifest.version) throw new Error("Mac app and bundled host versions differ.");
  const web = httpsUrl(plistValue("NanthAIWebURL"));
  const controlPlane = httpsUrl(plistValue("NanthAIControlPlaneURL"));
  let production;
  if (publish) {
    production = httpsUrl(required(env, "NANTHAI_CONVEX_PRODUCTION_URL"));
    if (web.origin !== httpsUrl(required(env, "NANTHAI_RUNTIME_WEB_URL")).origin) {
      throw new Error("The candidate does not use the intended production website.");
    }
    if (!production.hostname.endsWith(".convex.cloud")
      || controlPlane.hostname !== production.hostname.replace(/\.convex\.cloud$/, ".convex.site")) {
      throw new Error("The candidate and publication target must use the same Convex deployment.");
    }
  }

  await mkdir(outputDirectory, { recursive: true });
  const work = await mkdtemp(join(outputDirectory, `release-${manifest.version}-`));
  const layout = join(work, "layout");
  const app = join(layout, "NanthAI Runtime.app");
  const dmg = join(work, `NanthAI-Runtime-${manifest.version}-${manifest.node.arch}.dmg`);
  await mkdir(layout);
  await cp(source, app, { recursive: true, verbatimSymlinks: true });
  await symlink("/Applications", join(layout, "Applications"));
  run("codesign", ["--force", "--sign", identity, "--options", "runtime", "--timestamp",
    "--entitlements", join(root, "runtime-host/packaging/node.entitlements.plist"),
    join(app, "Contents/Resources/host/runtime/node")]);
  run("codesign", ["--force", "--sign", identity, "--options", "runtime", "--timestamp", app]);
  run("codesign", ["--verify", "--deep", "--strict", app]);
  run("hdiutil", ["create", "-volname", "NanthAI Runtime", "-srcfolder", layout, "-format", "UDZO", dmg]);
  run("codesign", ["--force", "--sign", identity, "--timestamp", dmg]);
  const notarization = JSON.parse(run("xcrun", ["notarytool", "submit", dmg,
    "--keychain-profile", profile, "--wait", "--output-format", "json"]));
  await writeFile(join(work, "notarization.json"), `${JSON.stringify(notarization, null, 2)}\n`);
  if (notarization.status !== "Accepted") throw new Error(`Notarization was not accepted; inspect ${work}/notarization.json.`);
  run("xcrun", ["stapler", "staple", dmg]);
  run("xcrun", ["stapler", "validate", dmg]);
  run("hdiutil", ["verify", dmg]);
  const assess = path => run("spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=2", path]);
  assess(dmg);
  const bytes = await readFile(dmg);
  const receipt = {
    version: manifest.version, sourceRevision: manifest.sourceRevision,
    dmg, sha256: hash(bytes), sizeBytes: bytes.length, notarizationId: notarization.id,
    convexPublished: false,
  };
  const receiptPath = join(work, "publication.json");
  const saveReceipt = () => writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  await saveReceipt();
  if (publish) {
    const convex = (name, args) => JSON.parse(run("npx", ["convex", "run", "--prod", name, JSON.stringify(args)]));
    const uploadUrl = deploymentUrl(convex("runtime_host/installer_storage:generateInstallerUploadUrl", {}), production.origin);
    const upload = await fetchImpl(uploadUrl, {
      method: "POST", headers: { "Content-Type": "application/x-apple-diskimage" },
      body: bytes, signal: globalThis.AbortSignal.timeout(120_000),
    });
    if (!upload.ok) throw new Error(`Installer upload failed (HTTP ${upload.status}).`);
    const { storageId } = await upload.json();
    if (typeof storageId !== "string" || !storageId) throw new Error("Upload returned no storage ID.");
    receipt.storageId = storageId;
    receipt.url = deploymentUrl(convex("runtime_host/installer_storage:getInstallerUrl", { storageId }), production.origin);
    await saveReceipt();
    const download = await fetchImpl(receipt.url, { signal: globalThis.AbortSignal.timeout(120_000) });
    if (!download.ok) throw new Error(`Installer download failed (HTTP ${download.status}).`);
    const downloaded = Buffer.from(await download.arrayBuffer());
    if (!bytes.equals(downloaded)) throw new Error("Downloaded installer differs from the verified local bytes.");
    const downloadedPath = join(work, "downloaded.dmg");
    await writeFile(downloadedPath, downloaded);
    run("xcrun", ["stapler", "validate", downloadedPath]);
    assess(downloadedPath);
    run("npx", ["convex", "env", "set", "NANTHAI_RUNTIME_HOST_DOWNLOAD_URL", receipt.url, "--prod"]);
    receipt.convexPublished = true;
    await saveReceipt();
  }
  return { ...receipt, receiptPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const paths = args.filter(arg => !arg.startsWith("--"));
  if (paths.length !== 1 || args.some(arg => arg.startsWith("--") && arg !== "--publish")) {
    console.error("Usage: node scripts/release-macos.mjs /path/to/Runtime.app [--publish]");
    process.exitCode = 1;
  } else {
    try {
      const result = await releaseMacosInstaller({ appPath: paths[0], publish: args.includes("--publish") });
      console.log(JSON.stringify(result, null, 2));
      if (result.convexPublished) console.log("Set the website's VITE_NANTHAI_RUNTIME_HOST_DOWNLOAD_URL to this URL and rebuild Netlify.");
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Runtime installer release failed.");
      process.exitCode = 1;
    }
  }
}
