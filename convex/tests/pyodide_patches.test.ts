import assert from "node:assert/strict";
import test from "node:test";

// Tests for pyodide_client patch functions.
// These are unit tests against Pyodide 0.29.3 snapshot strings — no CDN access required.
// If any test fails after a Pyodide upgrade, the patch needs updating.

import {
  patchDynamicImports,
  patchUrlHandling,
  patchAsmUrlHandling,
} from "../runtime/pyodide_client";

// ---------------------------------------------------------------------------
// Patch 1: (await import("node:X")).default  → require("node:X")
// ---------------------------------------------------------------------------

test("patchDynamicImports: patch 1 — ESM node: import with .default", () => {
  const input = `var vm = (await import("node:vm")).default;`;
  const output = patchDynamicImports(input);
  assert.match(output, /var vm = require\("node:vm"\)/);
  assert.doesNotMatch(output, /await import/);
});

test("patchDynamicImports: patch 1 — webpackIgnore comment variant", () => {
  const input = `var fs = (await import(/* webpackIgnore */"node:fs")).default;`;
  const output = patchDynamicImports(input);
  assert.match(output, /var fs = require\("node:fs"\)/);
  assert.doesNotMatch(output, /await import/);
});

// ---------------------------------------------------------------------------
// Patch 2: await import("node:X")  → require("node:X")
// ---------------------------------------------------------------------------

test("patchDynamicImports: patch 2 — bare node: import", () => {
  const input = `const path = await import("node:path");`;
  const output = patchDynamicImports(input);
  assert.match(output, /const path = require\("node:path"\)/);
  assert.doesNotMatch(output, /await import/);
});

test("patchDynamicImports: patch 2 — multiple node: imports", () => {
  const input = `const a = await import("node:fs"); const b = await import("node:url");`;
  const output = patchDynamicImports(input);
  assert.match(output, /require\("node:fs"\)/);
  assert.match(output, /require\("node:url"\)/);
  assert.doesNotMatch(output, /await import/);
});

// ---------------------------------------------------------------------------
// Patch 3: await import("ws")  → require("ws")
// ---------------------------------------------------------------------------

test("patchDynamicImports: patch 3 — ws third-party import", () => {
  const input = `const WebSocket = await import("ws");`;
  const output = patchDynamicImports(input);
  assert.match(output, /require\("ws"\)/);
  assert.doesNotMatch(output, /await import/);
});

// ---------------------------------------------------------------------------
// Patch 4: await import(XX.pathToFileURL(e).href)  → readFileSync + vm eval
// ---------------------------------------------------------------------------

test("patchDynamicImports: patch 4 — pathToFileURL local file import", () => {
  const input = `await import(/* webpackIgnore */url.pathToFileURL(modulePath).href)`;
  const output = patchDynamicImports(input);
  assert.match(output, /runInThisContext/);
  assert.match(output, /readFileSync\(modulePath/);
  assert.doesNotMatch(output, /await import/);
});

// ---------------------------------------------------------------------------
// Patch 5: async t=>await import(t)  → fetch+eval
// ---------------------------------------------------------------------------

test("patchDynamicImports: patch 5 — browser loadScript arrow function", () => {
  const input = `loadScript: async t=>await import(t)`;
  const output = patchDynamicImports(input);
  assert.match(output, /runInThisContext\(await\(await fetch\(t\)\)/);
  assert.doesNotMatch(output, /await import\(t\)/);
});

test("patchDynamicImports: patch 5 — single letter variable variant e", () => {
  const input = `async e=>await import(e)`;
  const output = patchDynamicImports(input);
  assert.match(output, /runInThisContext\(await\(await fetch\(e\)\)/);
  assert.doesNotMatch(output, /await import\(e\)/);
});

// ---------------------------------------------------------------------------
// Patch 6: worker fallback TypeError catch  → fetch+eval
// ---------------------------------------------------------------------------

test("patchDynamicImports: patch 6 — worker TypeError fallback", () => {
  const input = `if(e instanceof TypeError)await import(t);else throw e`;
  const output = patchDynamicImports(input);
  assert.match(output, /fetch\(t\)/);
  assert.match(output, /else throw e/);
  assert.doesNotMatch(output, /await import\(t\)/);
});

// ---------------------------------------------------------------------------
// Patch 7: path.resolve mangling HTTP URLs in pyodide.js
// ---------------------------------------------------------------------------

test("patchUrlHandling: patch 7 — skips path.resolve for https:// URLs", () => {
  const input = `function resolvePath(e,t){return path.resolve(t||".",e)}`;
  const output = patchUrlHandling(input);
  assert.match(output, /includes\(":\/\/"\)/);
  // must have the ternary: url stays as-is, non-url uses path.resolve
  assert.match(output, /\?e:path\.resolve/);
  assert.doesNotMatch(output, /^function resolvePath\(e,t\)\{return path\.resolve\(t\|\|"\.",e\)\}/);
});

// ---------------------------------------------------------------------------
// Patch 8: loadLockFile uses fetch() for URLs in pyodide.js
// ---------------------------------------------------------------------------

test("patchUrlHandling: patch 8 — loadLockFile uses fetch for URLs (f.IN_NODE)", () => {
  const input = `if(f.IN_NODE){await loadNodeModules();let data=await nodeFs.readFile(e,{encoding:"utf8"});return JSON.parse(data)}`;
  const output = patchUrlHandling(input);
  assert.match(output, /includes\(":\/\/"\)/);
  assert.match(output, /await fetch\(e\).*\.json\(\)/);
  // original readFile path still present as fallback
  assert.match(output, /readFile\(e,\{encoding:"utf8"\}\)/);
});

// ---------------------------------------------------------------------------
// patchAsmUrlHandling: patches for pyodide.asm.js
// ---------------------------------------------------------------------------

test("patchAsmUrlHandling: skips path.resolve for URLs (t,e param order)", () => {
  const input = `function np(t,e){return pathMod.resolve(e||".",t)}`;
  const output = patchAsmUrlHandling(input);
  assert.match(output, /includes\(":\/\/"\)/);
  assert.match(output, /\?t:pathMod\.resolve/);
});

test("patchAsmUrlHandling: skips path.resolve for URLs (e,t param order)", () => {
  const input = `function np(e,t){return pathMod.resolve(t||".",e)}`;
  const output = patchAsmUrlHandling(input);
  assert.match(output, /includes\(":\/\/"\)/);
  assert.match(output, /\?e:pathMod\.resolve/);
});

test("patchAsmUrlHandling: loadLockFile uses fetch for URLs (d.IN_NODE)", () => {
  const input = `if(d.IN_NODE){await loadMods();let e=await nodefs.readFile(t,{encoding:"utf8"});return JSON.parse(e)}`;
  const output = patchAsmUrlHandling(input);
  assert.match(output, /await fetch\(t\).*\.json\(\)/);
  assert.match(output, /readFile\(t,\{encoding:"utf8"\}\)/);
});

// ---------------------------------------------------------------------------
// Idempotency: applying patches twice should produce the same result
// ---------------------------------------------------------------------------

test("patchDynamicImports is idempotent", () => {
  const input = `const fs = await import("node:fs");`;
  const once = patchDynamicImports(input);
  const twice = patchDynamicImports(once);
  assert.equal(twice, once, "applying patch twice must produce the same result");
});

test("patchUrlHandling is idempotent", () => {
  const input = `function resolvePath(e,t){return path.resolve(t||".",e)}`;
  const once = patchUrlHandling(input);
  const twice = patchUrlHandling(once);
  assert.equal(twice, once, "applying patch twice must produce the same result");
});

// ---------------------------------------------------------------------------
// Safety: patches don't corrupt unrelated code
// ---------------------------------------------------------------------------

test("patchDynamicImports leaves non-import code unchanged", () => {
  const input = `const x = 1 + 2; function hello() { return 'world'; }`;
  const output = patchDynamicImports(input);
  assert.equal(output, input, "non-import code should be untouched");
});

test("patchUrlHandling leaves non-resolvePath code unchanged", () => {
  const input = `function doSomething(a,b){return a+b}`;
  const output = patchUrlHandling(input);
  assert.equal(output, input, "unrelated function should be untouched");
});

test("patchDynamicImports does not match partial word 'import'", () => {
  const input = `// We import only one thing\nconst importantData = 42;`;
  const output = patchDynamicImports(input);
  assert.equal(output, input, "comments and variable names containing 'import' should not be touched");
});
