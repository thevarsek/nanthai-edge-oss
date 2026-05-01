import assert from "node:assert/strict";
import test from "node:test";

import { SYSTEM_SKILL_CATALOG } from "../skills/catalog/index";
import { SystemSkillSeedData } from "../skills/mutations_seed";

// =============================================================================
// MARK: Catalog seed — structural integrity
// =============================================================================

test("SYSTEM_SKILL_CATALOG contains 71 skills", () => {
  assert.equal(SYSTEM_SKILL_CATALOG.length, 71);
});

test("SYSTEM_SKILL_CATALOG: all entries have required fields", () => {
  for (const skill of SYSTEM_SKILL_CATALOG) {
    assert.ok(skill.slug, `Missing slug for ${skill.name}`);
    assert.ok(skill.name, `Missing name for slug ${skill.slug}`);
    assert.ok(skill.summary, `Missing summary for ${skill.slug}`);
    assert.ok(skill.instructionsRaw, `Missing instructionsRaw for ${skill.slug}`);
    assert.ok(skill.scope === "system", `Scope must be "system" for ${skill.slug}`);
    assert.ok(
      skill.origin === "anthropicCurated" || skill.origin === "nanthaiBuiltin",
      `Invalid origin for ${skill.slug}: ${skill.origin}`,
    );
    assert.ok(
      skill.runtimeMode === "textOnly" ||
      skill.runtimeMode === "toolAugmented" ||
      skill.runtimeMode === "sandboxAugmented",
      `Invalid runtimeMode for ${skill.slug}: ${skill.runtimeMode}`,
    );
    assert.ok(
      skill.compilationStatus === "pending" || skill.compilationStatus === "compiled" || skill.compilationStatus === "failed",
      `Invalid compilationStatus for ${skill.slug}: ${skill.compilationStatus}`,
    );
    assert.ok(Array.isArray(skill.requiredToolIds), `requiredToolIds must be array for ${skill.slug}`);
    assert.ok(Array.isArray(skill.requiredToolProfiles ?? []), `requiredToolProfiles must be array for ${skill.slug}`);
    assert.ok(Array.isArray(skill.requiredIntegrationIds), `requiredIntegrationIds must be array for ${skill.slug}`);
    assert.ok(Array.isArray(skill.requiredCapabilities ?? []), `requiredCapabilities must be array for ${skill.slug}`);
  }
});

test("SYSTEM_SKILL_CATALOG: slugs are unique", () => {
  const slugs = SYSTEM_SKILL_CATALOG.map((s) => s.slug);
  const unique = new Set(slugs);
  assert.equal(unique.size, slugs.length, `Duplicate slugs found: ${slugs}`);
});

test("SYSTEM_SKILL_CATALOG: slugs are lowercase-hyphenated", () => {
  for (const skill of SYSTEM_SKILL_CATALOG) {
    assert.ok(
      /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(skill.slug),
      `Slug "${skill.slug}" is not lowercase-hyphenated`,
    );
  }
});

// =============================================================================
// MARK: Catalog seed — visible vs hidden partitioning
// =============================================================================

test("SYSTEM_SKILL_CATALOG: 60 visible + 1 hidden + 10 integration_managed skills", () => {
  const visible = SYSTEM_SKILL_CATALOG.filter((s) => s.visibility === "visible");
  const hidden = SYSTEM_SKILL_CATALOG.filter((s) => s.visibility === "hidden");
  const integrationManaged = SYSTEM_SKILL_CATALOG.filter((s) => s.visibility === "integration_managed");
  assert.equal(visible.length, 60);
  assert.equal(hidden.length, 1);
  assert.equal(integrationManaged.length, 10);
});

test("SYSTEM_SKILL_CATALOG: visible skills include the 5 original curated skills", () => {
  const visible = SYSTEM_SKILL_CATALOG.filter((s) => s.visibility === "visible");
  const slugs = new Set(visible.map((s) => s.slug));
  assert.ok(slugs.has("doc-coauthoring"));
  assert.ok(slugs.has("internal-comms"));
  assert.ok(slugs.has("docx"));
  assert.ok(slugs.has("pptx"));
  assert.ok(slugs.has("xlsx"));
});

test("SYSTEM_SKILL_CATALOG: hidden skills are runtime-guard only", () => {
  const hidden = SYSTEM_SKILL_CATALOG.filter((s) => s.visibility === "hidden");
  const slugs = new Set(hidden.map((s) => s.slug));
  assert.ok(slugs.has("nanthai-mobile-runtime"));
  assert.equal(hidden.length, 1);
});

// =============================================================================
// MARK: Catalog seed — mode classification
// =============================================================================

test("SYSTEM_SKILL_CATALOG: internal-comms is textOnly and doc-coauthoring can use document tools", () => {
  const internalComms = SYSTEM_SKILL_CATALOG.find((s) => s.slug === "internal-comms");
  assert.ok(internalComms);
  assert.equal(internalComms.runtimeMode, "textOnly");
  assert.deepEqual(internalComms.requiredToolIds, []);

  const docCoauthoring = SYSTEM_SKILL_CATALOG.find((s) => s.slug === "doc-coauthoring");
  assert.ok(docCoauthoring);
  assert.equal(docCoauthoring.runtimeMode, "toolAugmented");
  assert.deepEqual(
    [...docCoauthoring.requiredToolIds].sort(),
    ["find_in_document", "list_documents", "read_document"],
  );
});

test("SYSTEM_SKILL_CATALOG: docx, pptx, xlsx are toolAugmented with required tools", () => {
  const toolSkills = SYSTEM_SKILL_CATALOG.filter(
    (s) => s.slug === "docx" || s.slug === "pptx" || s.slug === "xlsx",
  );
  for (const skill of toolSkills) {
    assert.equal(skill.runtimeMode, "toolAugmented", `${skill.slug} should be toolAugmented`);
    assert.ok(skill.requiredToolIds.length > 0, `${skill.slug} should have required tools`);
  }
});

test("SYSTEM_SKILL_CATALOG: docs, runtime, and subagent skills have requiredToolProfiles", () => {
  const expectations: Record<string, string[]> = {
    "documents": ["docs", "persistentRuntime"],
    "docx": ["docs"],
    "pdf": ["docs", "persistentRuntime"],
    "pptx": ["docs"],
    "xlsx": ["docs", "analytics"],
    "data-analyzer": ["analytics"],
    "code-workspace": ["workspace"],
    "persistent-runtime": ["persistentRuntime"],
    "parallel-subagents": ["subagents"],
    "competitive-analysis": [],
    "multi-platform-launch": [],
    "ai-pricing": [],
  };

  for (const [slug, profiles] of Object.entries(expectations)) {
    const skill = SYSTEM_SKILL_CATALOG.find((entry) => entry.slug === slug);
    assert.ok(skill, `Missing skill ${slug}`);
    assert.deepEqual(skill.requiredToolProfiles ?? [], profiles, `${slug} profiles mismatch`);
  }
});

test("SYSTEM_SKILL_CATALOG: integration discovery skills are present", () => {
  const slugs = new Set(SYSTEM_SKILL_CATALOG.map((skill) => skill.slug));
  assert.ok(slugs.has("documents"));
  assert.ok(slugs.has("pdf"));
  assert.ok(slugs.has("persistent-runtime"));
  assert.ok(slugs.has("gmail"));
  assert.ok(slugs.has("google-drive"));
  assert.ok(slugs.has("google-calendar"));
  assert.ok(slugs.has("microsoft-365"));
  assert.ok(slugs.has("notion-workspace"));
  assert.ok(slugs.has("apple-calendar"));
  assert.ok(slugs.has("parallel-subagents"));
});

test("SYSTEM_SKILL_CATALOG: M33 document skills and template-like skills are present", () => {
  const slugs = new Set(SYSTEM_SKILL_CATALOG.map((skill) => skill.slug));
  for (const slug of [
    "document-review",
    "document-drafting",
    "contract-drafting",
    "legal-memo",
    "clause-extraction",
    "policy-review",
    "conditions-precedent-checklist",
    "credit-agreement-summary",
    "shareholder-agreement-summary",
  ]) {
    assert.ok(slugs.has(slug), `Missing M33 skill ${slug}`);
  }

  const templateLike = SYSTEM_SKILL_CATALOG.filter((skill) =>
    ["conditions-precedent-checklist", "credit-agreement-summary", "shareholder-agreement-summary"].includes(skill.slug)
  );
  for (const skill of templateLike) {
    assert.equal(skill.visibility, "visible");
    assert.equal(skill.lockState, "locked");
    assert.equal(skill.runtimeMode, "toolAugmented");
    assert.deepEqual(skill.requiredToolProfiles ?? [], ["docs"]);
  }
});

test("SYSTEM_SKILL_CATALOG: pdf requires read_pdf, generate_pdf, edit_pdf", () => {
  const pdf = SYSTEM_SKILL_CATALOG.find((s) => s.slug === "pdf");
  assert.ok(pdf);
  assert.deepEqual(
    [...pdf.requiredToolIds].sort(),
    ["edit_pdf", "find_in_document", "generate_pdf", "list_documents", "read_document", "read_pdf"],
  );
});

test("SYSTEM_SKILL_CATALOG: persistent-runtime requires the vm tool family", () => {
  const skill = SYSTEM_SKILL_CATALOG.find((s) => s.slug === "persistent-runtime");
  assert.ok(skill);
  assert.deepEqual(
    [...skill.requiredToolIds].sort(),
    [
      "vm_delete_file",
      "vm_exec",
      "vm_export_file",
      "vm_import_file",
      "vm_list_files",
      "vm_make_dirs",
      "vm_read_file",
      "vm_reset",
      "vm_write_file",
    ],
  );
});

test("SYSTEM_SKILL_CATALOG: docx requires generate_docx, read_docx, edit_docx", () => {
  const docx = SYSTEM_SKILL_CATALOG.find((s) => s.slug === "docx");
  assert.ok(docx);
  assert.deepEqual(
    [...docx.requiredToolIds].sort(),
    ["edit_docx", "generate_docx", "read_docx"],
  );
});

test("SYSTEM_SKILL_CATALOG: pptx requires generate_pptx, read_pptx, edit_pptx", () => {
  const pptx = SYSTEM_SKILL_CATALOG.find((s) => s.slug === "pptx");
  assert.ok(pptx);
  assert.deepEqual(
    [...pptx.requiredToolIds].sort(),
    ["edit_pptx", "generate_pptx", "read_pptx"],
  );
});

test("SYSTEM_SKILL_CATALOG: xlsx requires generate_xlsx, read_xlsx, edit_xlsx", () => {
  const xlsx = SYSTEM_SKILL_CATALOG.find((s) => s.slug === "xlsx");
  assert.ok(xlsx);
  assert.deepEqual(
    [...xlsx.requiredToolIds].sort(),
    ["edit_xlsx", "generate_xlsx", "read_xlsx"],
  );
});

// =============================================================================
// MARK: Catalog seed — origin classification
// =============================================================================

test("SYSTEM_SKILL_CATALOG: original 5 curated skills have anthropicCurated origin", () => {
  const curatedSlugs = ["doc-coauthoring", "internal-comms", "docx", "pptx", "xlsx"];
  for (const slug of curatedSlugs) {
    const skill = SYSTEM_SKILL_CATALOG.find((s) => s.slug === slug);
    assert.ok(skill, `Missing curated skill: ${slug}`);
    assert.equal(
      skill.origin,
      "anthropicCurated",
      `${slug} should have anthropicCurated origin`,
    );
  }
});

test("SYSTEM_SKILL_CATALOG: new visible skills have nanthaiBuiltin origin", () => {
  const curatedSlugs = new Set(["doc-coauthoring", "internal-comms", "docx", "pptx", "xlsx"]);
  const newVisible = SYSTEM_SKILL_CATALOG.filter(
    (s) => s.visibility === "visible" && !curatedSlugs.has(s.slug),
  );
  assert.ok(newVisible.length > 0, "Should have new visible skills");
  for (const skill of newVisible) {
    assert.equal(
      skill.origin,
      "nanthaiBuiltin",
      `${skill.slug} should have nanthaiBuiltin origin`,
    );
  }
});

test("SYSTEM_SKILL_CATALOG: hidden skills have nanthaiBuiltin origin", () => {
  const hidden = SYSTEM_SKILL_CATALOG.filter((s) => s.visibility === "hidden");
  for (const skill of hidden) {
    assert.equal(
      skill.origin,
      "nanthaiBuiltin",
      `${skill.slug} should have nanthaiBuiltin origin`,
    );
  }
});

// =============================================================================
// MARK: Catalog seed — all skills are locked + active
// =============================================================================

test("SYSTEM_SKILL_CATALOG: all system skills are locked", () => {
  for (const skill of SYSTEM_SKILL_CATALOG) {
    assert.equal(skill.lockState, "locked", `${skill.slug} should be locked`);
  }
});

test("SYSTEM_SKILL_CATALOG: only intentionally archived integration-discovery skills are not active", () => {
  // Gmail uses manual IMAP/SMTP auth, Drive uses Google OAuth + picker, and
  // Calendar uses Google OAuth. google-workspace is active as the shared
  // Google entry point; standalone google-calendar remains archived.
  const archivedSlugs = new Set([
    "apple-calendar",
    "google-calendar",
  ]);

  for (const skill of SYSTEM_SKILL_CATALOG) {
    const expectedStatus = archivedSlugs.has(skill.slug) ? "archived" : "active";
    assert.equal(skill.status, expectedStatus, `${skill.slug} should be ${expectedStatus}`);
  }
});

test("SYSTEM_SKILL_CATALOG: google-workspace exposes real Google Calendar tool names", () => {
  const workspace = SYSTEM_SKILL_CATALOG.find((s) => s.slug === "google-workspace");
  assert.ok(workspace);
  assert.equal(workspace.status, "active");
  assert.ok(workspace.requiredToolIds.includes("google_calendar_list"));
  assert.ok(workspace.requiredToolIds.includes("google_calendar_create"));
  assert.ok(workspace.requiredToolIds.includes("google_calendar_delete"));
  assert.ok(!workspace.requiredToolIds.includes("calendar_list"));
});

// =============================================================================
// MARK: Catalog seed — compilation status
// =============================================================================

test("SYSTEM_SKILL_CATALOG: all skills are seeded as compiled (no LLM compilation in v1)", () => {
  for (const skill of SYSTEM_SKILL_CATALOG) {
    assert.equal(
      skill.compilationStatus,
      "compiled",
      `${skill.slug} should be "compiled" — LLM compilation removed in v1`,
    );
  }
});
