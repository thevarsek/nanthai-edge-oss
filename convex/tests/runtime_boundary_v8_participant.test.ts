// convex/tests/runtime_boundary_v8_participant.test.ts
// =============================================================================
// Regression guard for the V8 / Node runtime split.
//
// `actions_run_generation_participant.ts` runs in the Convex V8 runtime. It
// MUST NOT statically import any module that declares `"use node"`, otherwise
// the entire participant orchestration is forced into the Node runtime — which
// breaks `npx convex dev/deploy` because Node-only built-ins (`node:path`,
// `tls`, `node:crypto`, etc.) start being pulled in transitively from leaf
// modules like `runtime/service_pdf.ts` and `tools/google/gmail_manual_client.ts`.
//
// This test failed historically when commit 91fad321 added
//   import { buildProgressiveToolRegistry } from "../tools/progressive_registry";
// to the V8 file. The fix replaced that import with an injected
// `onDocumentToolsScoped` callback supplied by the Node sibling action.
//
// See AGENTS.md "Convex Environments & Deploy" for runtime-split context.
// =============================================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const convexRoot = path.resolve(__dirname, "..");

/**
 * Read a file relative to convex/ and return its source.
 */
function readConvexSource(relativeFromConvex: string): string {
  return readFileSync(path.join(convexRoot, relativeFromConvex), "utf8");
}

/**
 * Returns true if the first non-blank, non-comment line of `source` is a
 * `"use node"` directive (Convex's runtime marker).
 */
function declaresUseNode(source: string): boolean {
  // Strip BOM if present.
  const cleaned = source.startsWith("\uFEFF") ? source.slice(1) : source;
  const lines = cleaned.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "") continue;
    if (line.startsWith("//")) continue;
    if (line.startsWith("/*")) {
      // Skip until closing */ on a later line. We deliberately don't try to
      // parse multi-line block comments perfectly — if a "use node" is hidden
      // behind a block comment it's not active anyway.
      continue;
    }
    return line === '"use node";' || line === "'use node';";
  }
  return false;
}

/**
 * Resolve an import specifier (e.g. "../tools/foo") found in a source file at
 * `fromFileRelativeFromConvex` to a path relative to convex/. Returns null
 * for non-relative imports (third-party packages, "convex/...", etc.) or for
 * imports we can't resolve to a real .ts/.tsx file on disk.
 */
function resolveRelativeImport(
  fromFileRelativeFromConvex: string,
  specifier: string,
): string | null {
  if (!specifier.startsWith(".")) return null;
  const fromDir = path.dirname(
    path.join(convexRoot, fromFileRelativeFromConvex),
  );
  const resolvedAbs = path.resolve(fromDir, specifier);
  const candidates = [
    `${resolvedAbs}.ts`,
    `${resolvedAbs}.tsx`,
    path.join(resolvedAbs, "index.ts"),
    path.join(resolvedAbs, "index.tsx"),
  ];
  for (const candidate of candidates) {
    try {
      readFileSync(candidate, "utf8");
      return path.relative(convexRoot, candidate);
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * Extract relative import specifiers from a TS source file. Captures both
 * `import ... from "..."` and bare `import "..."` (side-effect imports), but
 * skips dynamic `import("...")` and `import type ... from "..."` (the latter
 * is type-only and erased by the compiler, so it cannot pull a runtime
 * boundary into V8).
 */
function extractRelativeImports(source: string): string[] {
  const specs: string[] = [];
  // import ... from "..." — multi-line tolerant.
  const importFromRe = /^\s*import\s+(?!type\b)[\s\S]*?from\s+["']([^"']+)["']/gm;
  // bare side-effect: import "..."
  const bareImportRe = /^\s*import\s+["']([^"']+)["']/gm;
  for (const re of [importFromRe, bareImportRe]) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      specs.push(match[1]);
    }
  }
  return specs.filter((spec) => spec.startsWith("."));
}

test("V8 generation participant must not statically import any \"use node\" module", () => {
  const v8File = "chat/actions_run_generation_participant.ts";
  const source = readConvexSource(v8File);

  // Sanity: the file itself must not declare "use node".
  assert.equal(
    declaresUseNode(source),
    false,
    `${v8File} must remain a V8 module (no "use node" directive).`,
  );

  const specifiers = extractRelativeImports(source);
  const offenders: Array<{ specifier: string; resolved: string }> = [];

  for (const specifier of specifiers) {
    const resolved = resolveRelativeImport(v8File, specifier);
    if (!resolved) continue; // unresolved or non-relative; skip
    const importedSource = readConvexSource(resolved);
    if (declaresUseNode(importedSource)) {
      offenders.push({ specifier, resolved });
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `${v8File} statically imports Node-runtime modules. ` +
      `Move the offending logic behind an injected callback (see ` +
      `onProfilesExpanded / onDocumentToolsScoped) or wrap it in a separate ` +
      `Node action invoked via runAction. Offenders:\n` +
      offenders
        .map((o) => `  - "${o.specifier}" -> ${o.resolved}`)
        .join("\n"),
  );
});

test("Node sibling action wires onDocumentToolsScoped callback", () => {
  // Lock in the fix shape: actions_run_generation_participant_action.ts must
  // pass an onDocumentToolsScoped callback into generateForParticipant so the
  // V8 module can rebuild the registry without importing the Node builder.
  const nodeSibling = "chat/actions_run_generation_participant_action.ts";
  const source = readConvexSource(nodeSibling);

  assert.match(
    source,
    /onDocumentToolsScoped\s*:/,
    `${nodeSibling} must wire an onDocumentToolsScoped callback so the V8 ` +
      `participant module can rebuild its tool registry without statically ` +
      `importing the Node-only buildProgressiveToolRegistry.`,
  );
  assert.match(
    source,
    /buildProgressiveToolRegistry\s*\(/,
    `${nodeSibling} must call buildProgressiveToolRegistry inside its ` +
      `callback — the registry rebuild belongs in the Node action.`,
  );
});

test("declaresUseNode helper recognises the directive", () => {
  // Self-test for the helper, since the regression guard depends on it.
  assert.equal(declaresUseNode('"use node";\nimport x from "y";\n'), true);
  assert.equal(declaresUseNode("'use node';\n"), true);
  assert.equal(
    declaresUseNode('// header comment\n"use node";\nimport x from "y";\n'),
    true,
  );
  assert.equal(declaresUseNode('import x from "y";\n'), false);
  assert.equal(
    declaresUseNode('// "use node";\nimport x from "y";\n'),
    false,
    "directive in a comment must not count",
  );
});
