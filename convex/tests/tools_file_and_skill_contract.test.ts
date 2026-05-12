import assert from "node:assert/strict";
import test from "node:test";

import { generateTextFile } from "../tools/generate_text_file";
import { resolveImage, resolveSlideImages } from "../tools/image_resolver";
import { loadSkill } from "../tools/load_skill";
import { readTextFile } from "../tools/read_text_file";

test("readTextFile returns CSV preview data and a large-file warning", async () => {
  const largeCell = "x".repeat(50010);

  const result = await readTextFile.execute(
    {
      userId: "user_1",
      ctx: {
        storage: {
          get: async () =>
            new Blob([`name,notes\nAlice,"${largeCell}"\nBob,"hello"`], {
              type: "text/csv",
            }),
        },
      },
    } as any,
    { storageId: "storage_1" },
  );

  assert.equal(result.success, true);
  assert.equal((result.data as any).csvPreview.headers[0], "name");
  assert.equal((result.data as any).csvPreview.totalRows, 2);
  assert.equal(typeof (result.data as any).warning, "string");
});

test("readTextFile validates storage and handles empty and plain text files", async () => {
  const missingArg = await readTextFile.execute({} as any, {});
  assert.equal(missingArg.success, false);
  assert.equal(missingArg.error, "Missing or invalid 'storageId'");

  const invalid = await readTextFile.execute(
    { ctx: { storage: { get: async () => { throw new Error("bad id"); } } } } as any,
    { storageId: "bad" },
  );
  assert.equal(invalid.success, false);
  assert.match(String(invalid.error), /Invalid storageId/);

  const missingFile = await readTextFile.execute(
    { ctx: { storage: { get: async () => null } } } as any,
    { storageId: "missing" },
  );
  assert.equal(missingFile.success, false);
  assert.match(String(missingFile.error), /File not found/);

  const empty = await readTextFile.execute(
    { ctx: { storage: { get: async () => new Blob([" \n\t "], { type: "text/plain" }) } } } as any,
    { storageId: "empty" },
  );
  assert.equal(empty.success, true);
  assert.equal((empty.data as any).message, "The file is empty.");

  const plain = await readTextFile.execute(
    { ctx: { storage: { get: async () => new Blob(["# Notes\nNo table"], { type: "text/markdown" }) } } } as any,
    { storageId: "notes" },
  );
  assert.equal(plain.success, true);
  assert.equal((plain.data as any).csvPreview, undefined);
  assert.equal((plain.data as any).lineCount, 2);
});

test("generateTextFile sanitizes filenames and prefers CONVEX_SITE_URL", async () => {
  const originalSiteUrl = process.env.CONVEX_SITE_URL;
  const stored: Blob[] = [];
  process.env.CONVEX_SITE_URL = "https://nanth.ai";

  try {
    const result = await generateTextFile.execute(
      {
        userId: "user_1",
        ctx: {
          storage: {
            store: async (blob: Blob) => {
              stored.push(blob);
              return "storage_1";
            },
            getUrl: async () => "https://fallback.invalid/file",
          },
        },
      } as any,
      { filename: " report?/v1 ", format: "md", content: "# Title" },
    );

    assert.equal(result.success, true);
    assert.equal(stored.length, 1);
    assert.equal((result.data as any).filename, "reportv1.md");
    assert.equal(
      (result.data as any).downloadUrl,
      "https://nanth.ai/download?storageId=storage_1&filename=reportv1.md",
    );
  } finally {
    process.env.CONVEX_SITE_URL = originalSiteUrl;
  }
});

test("loadSkill infers missing tool profiles from tool and integration IDs", async () => {
  const result = await loadSkill.execute(
    {
      userId: "user_1",
      ctx: {
        runQuery: async () => ({
          slug: "research-helper",
          name: "Research Helper",
          runtimeMode: "toolAugmented",
          instructionsRaw: "Follow the research workflow.",
          requiredToolIds: ["read_text_file"],
          requiredToolProfiles: [],
          requiredIntegrationIds: ["gmail"],
          requiredCapabilities: ["pro"],
        }),
      },
    } as any,
    { name: "research-helper" },
  );

  assert.equal(result.success, true);
  assert.deepEqual((result.data as any).requiredToolProfiles, ["docs", "google"]);
  assert.equal((result.data as any).instructions, "Follow the research workflow.");
});

test("loadSkill validates slugs, preserves stored profiles, and surfaces lookup failures", async () => {
  const missingName = await loadSkill.execute({} as any, { name: "   " });
  assert.equal(missingName.success, false);
  assert.match(String(missingName.error), /Missing or empty/);

  const notFound = await loadSkill.execute(
    {
      userId: "user_1",
      ctx: { runQuery: async () => null },
    } as any,
    { name: "unknown-skill" },
  );
  assert.equal(notFound.success, false);
  assert.match(String(notFound.error), /No active skill found/);

  const storedProfiles = await loadSkill.execute(
    {
      userId: "user_1",
      ctx: {
        runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
          assert.equal(args.slug, "writer");
          assert.equal(args.userId, "user_1");
          return {
            slug: "writer",
            name: "Writer",
            runtimeMode: "instructionsOnly",
            instructionsRaw: "Write clearly.",
            requiredToolIds: ["read_text_file"],
            requiredToolProfiles: ["docs", "workspace"],
            requiredIntegrationIds: ["gmail"],
            requiredCapabilities: undefined,
          };
        },
      },
    } as any,
    { name: " writer " },
  );
  assert.equal(storedProfiles.success, true);
  assert.deepEqual((storedProfiles.data as any).requiredToolProfiles, ["docs", "workspace"]);
  assert.deepEqual((storedProfiles.data as any).requiredCapabilities, []);

  const failedLookup = await loadSkill.execute(
    {
      userId: "user_1",
      ctx: {
        runQuery: async () => {
          throw new Error("db unavailable");
        },
      },
    } as any,
    { name: "writer" },
  );
  assert.equal(failedLookup.success, false);
  assert.match(String(failedLookup.error), /Failed to load skill: db unavailable/);
});

test("image resolution supports direct data URIs and skips broken storage refs", async () => {
  const direct = await resolveImage(
    {
      storage: { get: async () => null },
    } as any,
    { data: "image/png;base64,AAAA", altText: "Inline" },
    0,
  );

  const slides = await resolveSlideImages(
    {
      storage: {
        get: async (id: string) =>
          id === "image_ok"
            ? new Blob([new Uint8Array([0, 1, 2])], { type: "image/png" })
            : null,
      },
    } as any,
    [
      { imageStorageId: "image_ok", altText: "Stored" },
      { imageStorageId: "missing_image" },
    ],
  );

  assert.deepEqual(direct, {
    data: "image/png;base64,AAAA",
    altText: "Inline",
  });
  assert.equal(slides.resolved[0]?.data, "image/png;base64,AAEC");
  assert.equal(slides.resolved[0]?.altText, "Stored");
  assert.equal(slides.warnings.length, 1);
});
