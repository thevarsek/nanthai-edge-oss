import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

type ImportGraph = {
  files: Set<string>;
  packages: Set<string>;
};

function staticImports(source: string): string[] {
  const specs: string[] = [];
  const importRegex = /\bimport\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g;
  const exportRegex = /\bexport\s+(?:type\s+)?[^'"]*?\s+from\s+["']([^"']+)["']/g;
  for (const regex of [importRegex, exportRegex]) {
    for (let match = regex.exec(source); match; match = regex.exec(source)) {
      specs.push(match[1]);
    }
  }
  return specs;
}

function packageRoot(specifier: string): string {
  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }
  return specifier.split("/")[0];
}

function resolveRelativeImport(fromFile: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    path.join(base, "index.ts"),
    path.join(base, "index.js"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function buildStaticImportGraph(entryRelativePath: string): ImportGraph {
  const entry = path.resolve(repoRoot, entryRelativePath);
  const files = new Set<string>();
  const packages = new Set<string>();
  const stack = [entry];

  while (stack.length > 0) {
    const file = stack.pop();
    if (!file || files.has(file)) continue;
    files.add(file);
    const source = readFileSync(file, "utf8");
    for (const specifier of staticImports(source)) {
      if (specifier.startsWith(".")) {
        const resolved = resolveRelativeImport(file, specifier);
        if (resolved && !files.has(resolved)) {
          stack.push(resolved);
        }
      } else {
        packages.add(packageRoot(specifier));
      }
    }
  }

  return { files, packages };
}

test("chat/actions eager import graph excludes analyzer-fragile tool implementations", () => {
  const graph = buildStaticImportGraph("convex/chat/actions.ts");
  const relativeFiles = Array.from(graph.files).map((file) =>
    path.relative(repoRoot, file),
  );

  const forbiddenFiles = [
    "convex/chat/actions_run_generation_participant_action.ts",
    "convex/tools/progressive_registry.ts",
    "convex/tools/progressive_registry_profiles.ts",
    "convex/tools/workspace_registry.ts",
    "convex/tools/google/drive.ts",
    "convex/tools/google/calendar.ts",
    "convex/tools/google/gmail.ts",
    "convex/tools/microsoft/outlook.ts",
    "convex/tools/microsoft/onedrive.ts",
    "convex/tools/microsoft/calendar.ts",
    "convex/tools/notion/pages.ts",
    "convex/tools/slack/tools.ts",
    "convex/tools/cloze/people.ts",
    "convex/tools/cloze/timeline.ts",
    "convex/tools/cloze/projects.ts",
    "convex/runtime/service_pdf.ts",
  ];
  for (const forbidden of forbiddenFiles) {
    assert.equal(relativeFiles.includes(forbidden), false, forbidden);
  }

  const forbiddenPackages = [
    "imapflow",
    "mailparser",
    "nodemailer",
    "pptxgenjs",
    "just-bash",
    "@vercel/sandbox",
    "pyodide",
  ];
  for (const forbiddenPackage of forbiddenPackages) {
    assert.equal(graph.packages.has(forbiddenPackage), false, forbiddenPackage);
  }
});

test("progressive registry imports provider proxy barrels instead of implementations", () => {
  const profiles = readFileSync(
    path.resolve(repoRoot, "convex/tools/progressive_registry_profiles.ts"),
    "utf8",
  );
  const providerIndexes = [
    "convex/tools/google/index.ts",
    "convex/tools/microsoft/index.ts",
    "convex/tools/notion/index.ts",
    "convex/tools/slack/index.ts",
    "convex/tools/cloze/index.ts",
  ];

  assert.equal(profiles.includes("./google/drive"), false);
  assert.equal(profiles.includes("./google/calendar"), false);
  assert.equal(profiles.includes("./microsoft/outlook"), false);
  assert.equal(profiles.includes("./notion/pages"), false);
  assert.equal(profiles.includes("./slack/tools"), false);
  assert.equal(profiles.includes("./cloze/people"), false);

  for (const providerIndex of providerIndexes) {
    const source = readFileSync(path.resolve(repoRoot, providerIndex), "utf8");
    assert.equal(source.includes("from \"./proxy\""), true, providerIndex);
  }
});
