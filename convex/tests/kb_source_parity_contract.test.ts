import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// =============================================================================
// M24 Phase 6 — KBFileRecord.source enum parity (Streamline #7)
//
// The Knowledge Base list/picker UI on every client renders a "source" badge
// from `KBFileRecord.source`. The canonical Convex contract is the union
//   "upload" | "generated" | "drive"
// (with "all" reserved as a filter sentinel — never a record value).
//
// This test guards against client drift: if the backend grows a new source
// kind, every client must declare the same literal so badges and filter
// chips render correctly. Catching a mismatch in CI is cheaper than chasing
// "why does this Drive file render as 'unknown' on Android" tickets later.
// =============================================================================

const REPO_ROOT = join(__dirname, "..", "..");

function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

test("KBFileRecord.source — Convex backend declares upload | generated | drive", () => {
  const src = readRepoFile("convex/knowledge_base/queries.ts");
  // Backend record type
  assert.match(
    src,
    /source:\s*"upload"\s*\|\s*"generated"\s*\|\s*"drive"\s*;/,
    "convex/knowledge_base/queries.ts must declare source as the canonical triple",
  );
  // Filter arg accepts the same triple plus the "all" sentinel
  assert.match(
    src,
    /source\?:\s*"upload"\s*\|\s*"generated"\s*\|\s*"drive"\s*\|\s*"all"/,
    "list filter arg must accept upload | generated | drive | all",
  );
});

test("KBFileRecord.source — web KBFile + KBSource declare the canonical triple", () => {
  const kbPage = readRepoFile("web/src/routes/KnowledgeBasePage.tsx");
  // KBSource (filter union — includes "all")
  assert.match(
    kbPage,
    /type\s+KBSource\s*=\s*"upload"\s*\|\s*"generated"\s*\|\s*"drive"\s*\|\s*"all"\s*;/,
    "web KBSource filter union must include drive",
  );
  // KBFile.source (record union — no "all")
  assert.match(
    kbPage,
    /source:\s*"upload"\s*\|\s*"generated"\s*\|\s*"drive"\s*;/,
    "web KBFile.source must include drive",
  );

  const picker = readRepoFile("web/src/components/chat/ChatKBPicker.tsx");
  assert.match(
    picker,
    /source:\s*"upload"\s*\|\s*"generated"\s*\|\s*"drive"\s*;/,
    "web ChatKBPicker KBFile.source must include drive",
  );
});

test("KBFileRecord.source — iOS KBFile DTO comment matches canonical triple", () => {
  // iOS uses `String` at runtime (Swift Decodable can't enforce a union),
  // so the doc comment is the only contract surface to lock down.
  const dto = readRepoFile("NanthAi-Edge/NanthAi-Edge/Models/DTOs/ConvexTypes.swift");
  assert.match(
    dto,
    /let\s+source:\s*String\s*\/\/\s*"upload"\s*\|\s*"generated"\s*\|\s*"drive"/,
    "iOS KBFile.source comment must list the canonical triple",
  );
});

test("KBFileRecord.source — Android KnowledgeFileSummary leaves source as String with default 'upload'", () => {
  // Android also has no first-class union type; the gateway maps the
  // wire-level string directly. We pin the default + the field type so any
  // refactor that loses the field surfaces here.
  const gateway = readRepoFile("android/app/src/main/java/com/nanthai/edge/data/ConvexGateway.kt");
  assert.match(
    gateway,
    /val\s+source:\s*String\s*=\s*"upload"\s*,/,
    "Android KnowledgeFileSummary must keep source: String with default \"upload\"",
  );
});

test("KB function paths — clients reference knowledge_base/* (not chat/*) for KB ops", () => {
  // M24 Phase 6 relocated KB queries/mutations out of convex/chat/ into
  // convex/knowledge_base/. If any client regresses to the old path, the
  // Convex deploy will throw FunctionNotFound at runtime — pin this here so
  // the failure shows up at test time instead.
  const targets: Array<{ file: string; mustContain: string[]; mustNotContain: string[] }> = [
    {
      file: "web/src/lib/constants.ts",
      mustContain: [
        "knowledge_base/queries:listKnowledgeBaseFiles",
        "knowledge_base/mutations:deleteKnowledgeBaseFile",
      ],
      mustNotContain: [
        "chat/queries:listKnowledgeBaseFiles",
        "chat/mutations:deleteKnowledgeBaseFile",
      ],
    },
    {
      file: "NanthAi-Edge/NanthAi-Edge/Utilities/Constants.swift",
      mustContain: [
        "knowledge_base/queries:listKnowledgeBaseFiles",
        "knowledge_base/mutations:deleteKnowledgeBaseFile",
      ],
      mustNotContain: [
        "chat/queries:listKnowledgeBaseFiles",
        "chat/mutations:deleteKnowledgeBaseFile",
      ],
    },
    {
      file: "android/app/src/main/java/com/nanthai/edge/data/RealConvexGateway.kt",
      mustContain: [
        "knowledge_base/queries:listKnowledgeBaseFiles",
        "knowledge_base/mutations:deleteKnowledgeBaseFile",
      ],
      mustNotContain: [
        "chat/queries:listKnowledgeBaseFiles",
        "chat/mutations:deleteKnowledgeBaseFile",
      ],
    },
  ];

  for (const { file, mustContain, mustNotContain } of targets) {
    const contents = readRepoFile(file);
    for (const needle of mustContain) {
      assert.ok(
        contents.includes(needle),
        `${file} must contain "${needle}" after Phase 6 relocation`,
      );
    }
    for (const stale of mustNotContain) {
      assert.ok(
        !contents.includes(stale),
        `${file} must not reference stale path "${stale}" after Phase 6 relocation`,
      );
    }
  }
});
