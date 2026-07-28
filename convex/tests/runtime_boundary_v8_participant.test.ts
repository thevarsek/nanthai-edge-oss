// convex/tests/runtime_boundary_v8_participant.test.ts
// =============================================================================
// Regression guard for the V8 / Node runtime split.
//
// `actions_runtime.ts` registers the bounded coordinator and participant
// actions in the Convex V8 runtime. `actions_run_generation_participant.ts`
// implements the bounded participant path there. Neither may declare
// `"use node"` or statically import a Node registration module: Node-required
// work delegates through `actions_node.ts` only after runtime-safety preflight.
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

test("bounded generation action registrations remain in V8", () => {
  const runtimeFile = "chat/actions_runtime.ts";
  const runtimeSource = readConvexSource(runtimeFile);
  const nodeFile = "chat/actions_node.ts";
  const nodeSource = readConvexSource(nodeFile);

  assert.equal(
    declaresUseNode(runtimeSource),
    false,
    `${runtimeFile} is the bounded V8 entry point. Node-required work must ` +
      `delegate through ${nodeFile} after runtime-safety preflight.`,
  );
  assert.equal(
    declaresUseNode(nodeSource),
    true,
    `${nodeFile} must remain the explicit Node-only sibling action.`,
  );
  assert.doesNotMatch(
    runtimeSource,
    /actions_run_generation_participant_action/,
    `${runtimeFile} must not import the Node participant handler directly.`,
  );
  assert.match(
    runtimeSource,
    /actions_run_generation_participant_runtime/,
    `${runtimeFile} must register the runtime-routing handler.`,
  );
});

test("the deferred subagent capability remains V8-safe until the model chooses it", () => {
  const runtimeSafety = readConvexSource("tools/runtime_safety.ts");
  const runtimeRegistry = readConvexSource("tools/progressive_registry_runtime.ts");
  const spawnTool = readConvexSource("tools/spawn_subagents.ts");

  assert.match(runtimeSafety, /"spawn_subagents"/);
  assert.match(runtimeSafety, /"subagents"/);
  assert.match(runtimeRegistry, /registry\.register\(spawnSubagents\)/);
  assert.equal(
    declaresUseNode(spawnTool),
    false,
    "spawn_subagents returns a deferred checkpoint request and must remain V8-safe",
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
