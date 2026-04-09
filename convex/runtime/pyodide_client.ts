"use node";

// convex/runtime/pyodide_client.ts
// =============================================================================
// Pyodide runtime client for data_python_exec.
//
// Pyodide runs inside a Convex Node.js action. Convex does not support
// dynamic import(), so we fetch both pyodide.js and pyodide.asm.js from CDN
// at runtime, apply 9 patches to replace all dynamic imports with require(),
// then eval. See milestone M27-free-code-execution.md §Prototype Results for
// full list of patches and why each is needed.
//
// Version lock: all patches target Pyodide 0.29.3. A version upgrade requires
// running scripts/pyodide_version_check.mjs first.
// =============================================================================

import { guessMimeTypeFromPath } from "./shared";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PYODIDE_VERSION = "0.29.3";
export const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const PACKAGE_CACHE_DIR = "/tmp/pyodide-cache";
const DEFAULT_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Public result type
// ---------------------------------------------------------------------------

export type PyodideErrorType =
  | "syntax"
  | "runtime"
  | "package_unavailable"
  | "memory"
  | "timeout"
  | null;

export interface PyodideExecResult {
  stdout: string[];
  stderr: string[];
  returnValue: unknown;
  error: string | null;
  errorType: PyodideErrorType;
  /** true when the model should retry the same task with data_python_sandbox */
  canRetryWithSandbox: boolean;
  charts: Array<{ pngBytes: Uint8Array; index: number }>;
  outputFiles: Array<{ path: string; bytes: Uint8Array; mimeType: string }>;
  memoryRssMiB: {
    baseline: number;
    afterLoad: number;
    afterPackages: number;
    afterExecution: number;
  };
}

// ---------------------------------------------------------------------------
// Patch 1-6: dynamic import() → require() / fetch+eval
// Applied to both pyodide.js and pyodide.asm.js
// ---------------------------------------------------------------------------

export function patchDynamicImports(code: string): string {
  let patched = code;

  // Patch 1: `(await import("node:X")).default` → `require("node:X")`
  // ESM dynamic import returns a namespace object; CJS require returns the module directly.
  patched = patched.replace(
    /\(await import\((?:\/\* webpackIgnore \*\/)?"(node:[^"]+)"\)\)\.default/g,
    'require("$1")',
  );

  // Patch 2: `await import("node:X")` → `require("node:X")`
  patched = patched.replace(
    /await import\((?:\/\* webpackIgnore \*\/)?"(node:[^"]+)"\)/g,
    'require("$1")',
  );

  // Patch 3: `await import("ws")` → `require("ws")`
  patched = patched.replace(
    /await import\((?:\/\* webpackIgnore \*\/)?"ws"\)/g,
    'require("ws")',
  );

  // Patch 4: `await import(XX.pathToFileURL(e).href)` → fs.readFileSync + vm eval
  patched = patched.replace(
    /await import\((?:\/\* webpackIgnore \*\/)?(\w+)\.pathToFileURL\((\w+)\)\.href\)/g,
    '(function(){var _vm=require("node:vm");var _fs=require("node:fs");_vm.runInThisContext(_fs.readFileSync($2,"utf-8"))})()',
  );

  // Patch 5: browser main-thread loadScript `async t=>await import(t)`
  patched = patched.replace(
    /async (\w+)=>await import\((?:\/\* webpackIgnore \*\/)?\1\)/g,
    'async $1=>{var _vm=require("node:vm");_vm.runInThisContext(await(await fetch($1)).text())}',
  );

  // Patch 6: web worker fallback `if(e instanceof TypeError)await import(t);else throw e`
  patched = patched.replace(
    /if\((\w+) instanceof TypeError\)await import\((?:\/\* webpackIgnore \*\/)?(\w+)\);else throw (\w+)/g,
    "if($1 instanceof TypeError)(async()=>{var _vm=require(\"node:vm\");_vm.runInThisContext(await(await fetch($2)).text())})();else throw $3",
  );

  return patched;
}

// ---------------------------------------------------------------------------
// Patches 7-8 for pyodide.js (main loader)
// - Patch 7: path.resolve mangling HTTP URLs
// - Patch 8: loadLockFile fs.readFile on CDN URL
// ---------------------------------------------------------------------------

export function patchUrlHandling(code: string): string {
  let patched = code;

  // Patch 7: fix node_resolvePath to skip path.resolve for URLs
  // Original: `function XX(e,t){return YY.resolve(t||".",e)}`
  patched = patched.replace(
    /function (\w+)\(e,t\)\{return (\w+)\.resolve\(t\|\|"\.",e\)\}/,
    'function $1(e,t){return e.includes("://")?e:$2.resolve(t||".",e)}',
  );

  // Patch 8: fix loadLockFile to use fetch() when path is a URL
  // Original: `if(f.IN_NODE){await XX();let YY=await ZZ.readFile(e,{encoding:"utf8"});return JSON.parse(YY)}`
  patched = patched.replace(
    /if\(f\.IN_NODE\)\{await (\w+)\(\);let (\w+)=await (\w+)\.readFile\(e,\{encoding:"utf8"\}\);return JSON\.parse\(\2\)\}/,
    'if(f.IN_NODE){await $1();if(e.includes("://")){return await(await fetch(e)).json()}let $2=await $3.readFile(e,{encoding:"utf8"});return JSON.parse($2)}',
  );

  return patched;
}

// ---------------------------------------------------------------------------
// URL handling patches for pyodide.asm.js (different variable names)
// ---------------------------------------------------------------------------

export function patchAsmUrlHandling(code: string): string {
  let patched = code;

  // Variant with (t,e) parameter order
  patched = patched.replace(
    /function (\w+)\(t,e\)\{return (\w+)\.resolve\(e\|\|"\.",t\)\}/,
    'function $1(t,e){return t.includes("://")?t:$2.resolve(e||".",t)}',
  );

  // Variant with (e,t) parameter order (same pattern as pyodide.js)
  patched = patched.replace(
    /function (\w+)\(e,t\)\{return (\w+)\.resolve\(t\|\|"\.",e\)\}/,
    'function $1(e,t){return e.includes("://")?e:$2.resolve(t||".",e)}',
  );

  // loadLockFile variant in asm.js uses variable `d` for IN_NODE check
  patched = patched.replace(
    /if\(d\.IN_NODE\)\{await (\w+)\(\);let (\w+)=await (\w+)\.readFile\((\w+),\{encoding:"utf8"\}\);return JSON\.parse\(\2\)\}/,
    'if(d.IN_NODE){await $1();if($4.includes("://")){return await(await fetch($4)).json()}let $2=await $3.readFile($4,{encoding:"utf8"});return JSON.parse($2)}',
  );

  return patched;
}

// ---------------------------------------------------------------------------
// Well-known output directory.
// Files written here are auto-captured as output artifacts after execution,
// even when the model does not pass exportPaths.
// ---------------------------------------------------------------------------

const AUTO_CAPTURE_DIR = "/tmp/outputs";

// ---------------------------------------------------------------------------
// Chart capture shim
// Prepended to user code when captureCharts=true.
// Patches plt.show() to save figures to /tmp/_nanthai_charts/.
// ---------------------------------------------------------------------------

const CHART_CAPTURE_SHIM = `
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as _plt_orig
import io as _io
import os as _os

_nanthai_chart_dir = '/tmp/_nanthai_charts'
_os.makedirs(_nanthai_chart_dir, exist_ok=True)
_nanthai_chart_index = [0]

def _nanthai_show(*args, **kwargs):
    for fig in _plt_orig.get_fignums():
        _buf = _io.BytesIO()
        _plt_orig.figure(fig).savefig(_buf, format='png', dpi=100, bbox_inches='tight')
        _plt_orig.close(fig)
        _buf.seek(0)
        _path = f'{_nanthai_chart_dir}/chart_{_nanthai_chart_index[0]}.png'
        with open(_path, 'wb') as _f:
            _f.write(_buf.read())
        _nanthai_chart_index[0] += 1

_plt_orig.show = _nanthai_show
import matplotlib.pyplot as plt
`.trimStart();

// ---------------------------------------------------------------------------
// Setup shim — always prepended to user code.
// Creates /tmp/outputs/ so the model can save files there without boilerplate.
// ---------------------------------------------------------------------------

const SETUP_SHIM = `
import os as _os
_os.makedirs('/tmp/outputs', exist_ok=True)
`.trimStart();

// ---------------------------------------------------------------------------
// Load and initialize Pyodide (internal)
// ---------------------------------------------------------------------------

interface PyodideInstance {
  loadPackage: (packages: string[]) => Promise<void>;
  runPython: (code: string) => unknown;
  runPythonAsync: (code: string) => Promise<unknown>;
  setStdout: (opts: { batched: (msg: string) => void }) => void;
  setStderr: (opts: { batched: (msg: string) => void }) => void;
  FS: {
    readFile: (path: string) => Uint8Array;
    writeFile: (path: string, data: Uint8Array) => void;
    mkdir: (path: string) => void;
    readdir: (path: string) => string[];
    stat: (path: string) => { mode: number };
  };
}

function memRssMiB(): number {
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
}

// ---------------------------------------------------------------------------
// Module-level cache for fetched + patched Pyodide source code.
// Convex Node.js isolates reuse module scope across action invocations, so
// caching here avoids re-fetching ~1 MiB from jsdelivr CDN on every call.
// The cache holds patched source strings only — Pyodide instances are NOT
// cached (each call needs a fresh interpreter for isolation).
// ---------------------------------------------------------------------------

let cachedPatchedAsmJs: string | null = null;
let cachedPatchedPyodideJs: string | null = null;

async function getPatchedAsmJs(): Promise<string> {
  if (cachedPatchedAsmJs) return cachedPatchedAsmJs;
  const rawAsmJs = await (await fetch(`${PYODIDE_CDN}pyodide.asm.js`)).text();
  let patched = patchDynamicImports(rawAsmJs);
  patched = patchAsmUrlHandling(patched);
  cachedPatchedAsmJs = patched;
  return patched;
}

async function getPatchedPyodideJs(): Promise<string> {
  if (cachedPatchedPyodideJs) return cachedPatchedPyodideJs;
  const rawPyodideJs = await (await fetch(`${PYODIDE_CDN}pyodide.js`)).text();
  let patched = patchDynamicImports(rawPyodideJs);
  patched = patchUrlHandling(patched);
  cachedPatchedPyodideJs = patched;
  return patched;
}

async function loadPyodideInstance(packages: string[]): Promise<{
  pyodide: PyodideInstance;
  memAfterLoad: number;
  memAfterPackages: number;
}> {
  const vm = require("node:vm") as typeof import("vm");

  // Fetch, patch, and eval pyodide.asm.js (cached after first call)
  const patchedAsmJs = await getPatchedAsmJs();
  vm.runInThisContext(patchedAsmJs, { filename: "pyodide.asm.js" });

  const memAfterLoad = memRssMiB();

  // Fetch, patch pyodide.js (cached after first call)
  const patchedPyodideJs = await getPatchedPyodideJs();

  // Eval as CJS module to get loadPyodide export
  const moduleObj = { exports: {} as Record<string, unknown> };
  const wrappedCode = `(function(module, exports, require, __filename, __dirname) {\n${patchedPyodideJs}\n})`;
  const compiledFn = vm.runInThisContext(wrappedCode, { filename: "pyodide.js" }) as (
    m: typeof moduleObj,
    e: typeof moduleObj.exports,
    r: NodeRequire,
    f: string,
    d: string,
  ) => void;
  compiledFn(moduleObj, moduleObj.exports, require, "pyodide.js", "/tmp");

  const loadPyodide = moduleObj.exports.loadPyodide as (opts: Record<string, unknown>) => Promise<PyodideInstance>;

  // Initialize Pyodide — packageCacheDir must be /tmp to avoid mkdir("https:/")
  const pyodide = await loadPyodide({
    indexURL: PYODIDE_CDN,
    packageCacheDir: PACKAGE_CACHE_DIR,
  });

  // Load requested packages
  if (packages.length > 0) {
    await pyodide.loadPackage(packages);
  }

  const memAfterPackages = memRssMiB();

  return { pyodide, memAfterLoad, memAfterPackages };
}

// ---------------------------------------------------------------------------
// Classify a Python error into our errorType taxonomy
// ---------------------------------------------------------------------------

function classifyPythonError(message: string): {
  errorType: PyodideErrorType;
  canRetryWithSandbox: boolean;
} {
  if (/ModuleNotFoundError|No module named/i.test(message)) {
    return { errorType: "package_unavailable", canRetryWithSandbox: true };
  }
  if (/MemoryError|out of memory/i.test(message)) {
    return { errorType: "memory", canRetryWithSandbox: true };
  }
  if (/SyntaxError/i.test(message)) {
    return { errorType: "syntax", canRetryWithSandbox: false };
  }
  return { errorType: "runtime", canRetryWithSandbox: false };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Re-export the canonical MIME lookup from shared.ts under the local name
// used by this module (avoids renaming every call site).
const guessMimeForExportPath = guessMimeTypeFromPath;

export async function runPyodideCode(
  code: string,
  inputFiles?: Array<{ path: string; bytes: Uint8Array }>,
  captureCharts?: boolean,
  timeoutMs?: number,
  exportPaths?: string[],
): Promise<PyodideExecResult> {
  const effectiveTimeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const memBaseline = memRssMiB();

  // Detect packages needed from imports (auto-detect numpy/pandas/matplotlib)
  const KNOWN_PACKAGES = ["numpy", "pandas", "matplotlib"];
  const packagesToLoad: string[] = [];
  for (const pkg of KNOWN_PACKAGES) {
    if (new RegExp(`\\b(import\\s+${pkg}|from\\s+${pkg}\\s+import)`, "i").test(code)) {
      packagesToLoad.push(pkg);
    }
  }
  // Always load numpy+pandas+matplotlib together if any one is requested —
  // pandas depends on numpy, and they're cached after the first cold load.
  if (packagesToLoad.length > 0) {
    for (const pkg of KNOWN_PACKAGES) {
      if (!packagesToLoad.includes(pkg)) packagesToLoad.push(pkg);
    }
  }

  let pyodide: PyodideInstance;
  let memAfterLoad: number;
  let memAfterPackages: number;

  try {
    ({ pyodide, memAfterLoad, memAfterPackages } = await loadPyodideInstance(packagesToLoad));
  } catch (loadErr: unknown) {
    const message = loadErr instanceof Error ? loadErr.message : String(loadErr);
    return {
      stdout: [],
      stderr: [],
      returnValue: null,
      error: `Failed to initialize Python environment: ${message}`,
      errorType: "runtime",
      canRetryWithSandbox: true,
      charts: [],
      outputFiles: [],
      memoryRssMiB: {
        baseline: memBaseline,
        afterLoad: memRssMiB(),
        afterPackages: memRssMiB(),
        afterExecution: memRssMiB(),
      },
    };
  }

  const stdout: string[] = [];
  const stderr: string[] = [];
  pyodide.setStdout({ batched: (msg) => stdout.push(msg) });
  pyodide.setStderr({ batched: (msg) => stderr.push(msg) });

  // Write input files into Pyodide FS
  if (inputFiles && inputFiles.length > 0) {
    for (const file of inputFiles) {
      try {
        // Create the parent directory if needed. Note: Pyodide's FS.mkdir()
        // does NOT support recursive creation. This works because all current
        // callers use flat paths like "/tmp/inputs/<filename>" (single-level
        // parent). If nested paths are ever needed, this must be replaced with
        // a loop that creates each path segment.
        const dir = file.path.split("/").slice(0, -1).join("/");
        if (dir) {
          try { pyodide.FS.mkdir(dir); } catch { /* already exists */ }
        }
        pyodide.FS.writeFile(file.path, file.bytes);
      } catch { /* best-effort */ }
    }
  }

  // Build final code: always prepend setup shim (creates /tmp/outputs/),
  // optionally prepend chart shim when matplotlib is loaded.
  const matplotlibLoaded = packagesToLoad.includes("matplotlib");
  const chartShim = captureCharts && matplotlibLoaded ? CHART_CAPTURE_SHIM + "\n" : "";
  const finalCode = SETUP_SHIM + chartShim + code;

  // Execute with timeout
  // ⚠ KNOWN LIMITATION — WASM timeout is best-effort only.
  // Pyodide runs Python inside a single-threaded WASM instance. JavaScript's
  // `setTimeout` fires on the same event loop, so if WASM blocks the thread
  // (tight loop, heavy NumPy computation, etc.) the timeout callback cannot
  // interrupt it — `Promise.race` only resolves once WASM yields back to JS.
  // True preemptive cancellation would require either SharedArrayBuffer +
  // Atomics (unavailable in Convex) or running Pyodide in a Worker thread.
  // For CPU-heavy workloads, callers should prefer `data_python_sandbox`
  // which runs in a Vercel sandbox with proper OS-level timeout support.
  let returnValue: unknown = null;
  let execError: string | null = null;
  let errorType: PyodideErrorType = null;
  let canRetryWithSandbox = false;

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const execPromise = pyodide.runPythonAsync(finalCode);
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error("Execution timed out")), effectiveTimeout);
    });
    returnValue = await Promise.race([execPromise, timeoutPromise]);
  } catch (execErr: unknown) {
    const message = execErr instanceof Error ? execErr.message : String(execErr);
    if (/timed? ?out/i.test(message)) {
      execError = `Execution timed out after ${effectiveTimeout}ms.\n→ Retry this task using data_python_sandbox, which supports long-running computations (up to 45 min).`;
      errorType = "timeout";
      canRetryWithSandbox = true;
    } else {
      const classified = classifyPythonError(message);
      errorType = classified.errorType;
      canRetryWithSandbox = classified.canRetryWithSandbox;

      if (errorType === "package_unavailable") {
        const modMatch = message.match(/No module named '([^']+)'/);
        const modName = modMatch ? modMatch[1] : "unknown package";
        execError =
          `ERROR (package_unavailable): ${message}\n` +
          `${modName} is not available in the lightweight Python environment.\n` +
          `→ Retry this task using data_python_sandbox, which supports pip install.`;
      } else if (errorType === "memory") {
        execError =
          `ERROR (memory): ${message}\n` +
          `→ Retry this task using data_python_sandbox, which provides up to 8 GB memory.`;
      } else {
        execError = message;
      }
    }
  } finally {
    clearTimeout(timeoutHandle);
  }

  const memAfterExecution = memRssMiB();

  // Collect chart PNGs (only when matplotlib was loaded and chart shim was injected)
  const charts: Array<{ pngBytes: Uint8Array; index: number }> = [];
  if (captureCharts && matplotlibLoaded && !execError) {
    try {
      const chartDir = "/tmp/_nanthai_charts";
      const entries = pyodide.FS.readdir(chartDir);
      const pngFiles = entries
        .filter((f) => f.endsWith(".png"))
        .sort();
      for (let i = 0; i < pngFiles.length; i++) {
        try {
          const pngBytes = pyodide.FS.readFile(`${chartDir}/${pngFiles[i]}`);
          charts.push({ pngBytes, index: i });
        } catch { /* skip unreadable */ }
      }
    } catch { /* chart dir may not exist if no charts were generated */ }
  }

  // Collect exported files from Pyodide FS
  const outputFiles: Array<{ path: string; bytes: Uint8Array; mimeType: string }> = [];

  // 1. Explicit exportPaths (model-specified)
  if (exportPaths && exportPaths.length > 0 && !execError) {
    for (const exportPath of exportPaths) {
      try {
        const bytes = pyodide.FS.readFile(exportPath);
        const mimeType = guessMimeForExportPath(exportPath);
        outputFiles.push({ path: exportPath, bytes, mimeType });
      } catch {
        // File may not exist — skip silently (user code may not have written it)
      }
    }
  }

  // 2. Auto-capture: scan /tmp/outputs/ for any files the code wrote there.
  //    This makes CSV/JSON/etc. exports "just work" without requiring the model
  //    to pass exportPaths — the model only needs to write to /tmp/outputs/.
  if (!execError) {
    const alreadyCaptured = new Set(outputFiles.map((f) => f.path));
    try {
      const entries = pyodide.FS.readdir(AUTO_CAPTURE_DIR);
      for (const entry of entries) {
        if (entry === "." || entry === "..") continue;
        const fullPath = `${AUTO_CAPTURE_DIR}/${entry}`;
        if (alreadyCaptured.has(fullPath)) continue;
        try {
          // Skip directories (stat().mode & 0o40000 is the S_IFDIR flag)
          const stat = pyodide.FS.stat(fullPath);
          if (stat.mode & 0o40000) continue;
          const bytes = pyodide.FS.readFile(fullPath);
          const mimeType = guessMimeForExportPath(fullPath);
          outputFiles.push({ path: fullPath, bytes, mimeType });
        } catch { /* skip unreadable files */ }
      }
    } catch { /* /tmp/outputs/ may not exist if setup shim didn't run */ }
  }

  return {
    stdout,
    stderr,
    returnValue,
    error: execError,
    errorType,
    canRetryWithSandbox,
    charts,
    outputFiles,
    memoryRssMiB: {
      baseline: memBaseline,
      afterLoad: memAfterLoad,
      afterPackages: memAfterPackages,
      afterExecution: memAfterExecution,
    },
  };
}
