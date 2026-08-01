import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "..");
const CREDENTIAL_MODULES = [
  "oauth/openrouter.ts",
  "oauth/google.ts",
  "oauth/microsoft.ts",
  "oauth/notion.ts",
  "oauth/slack.ts",
  "oauth/cloze.ts",
  "tools/google/calendar.ts",
  "tools/google/drive.ts",
  "tools/microsoft/calendar.ts",
  "tools/microsoft/outlook.ts",
  "tools/microsoft/onedrive.ts",
  "tools/notion/pages.ts",
  "tools/apple/calendar_write.ts",
  "tools/apple/client.ts",
  "tools/cloze/client.ts",
  "tools/cloze/people.ts",
  "tools/cloze/projects.ts",
  "tools/cloze/timeline.ts",
  "tools/slack/client.ts",
  "tools/slack/mcp_probe.ts",
  "lib/openrouter_error.ts",
  "lib/openrouter_image.ts",
  "lib/openrouter_nonstream.ts",
  "lib/openrouter_responses.ts",
  "lib/openrouter_stream.ts",
  "lib/openrouter_video.ts",
];

test("credential modules do not construct errors from raw provider bodies", async () => {
  for (const relativePath of CREDENTIAL_MODULES) {
    const source = await readFile(join(ROOT, relativePath), "utf8");
    assert.doesNotMatch(source, /:\s*\$\{(?:responseBody|body\.slice|text\.slice)/);
    assert.doesNotMatch(source, /JSON\.stringify\((?:init|list|call).*parsed/);
    assert.doesNotMatch(source, /message:\s*`[^`]*\$\{(?:responseText|errorText)/);
    assert.doesNotMatch(source, /(?:error|body):\s*(?:errorMessage|responseText|errorText)/);
  }
});

test("updated clients contain no direct OpenRouter key exchange endpoint", async () => {
  const roots = [
    join(ROOT, "..", "web", "src"),
    join(ROOT, "..", "android", "app", "src", "main"),
    join(ROOT, "..", "NanthAi-Edge", "NanthAi-Edge"),
  ];
  const endpoint = "/api/v1/auth/keys";
  for (const root of roots) {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    await assert.rejects(run("rg", ["-l", endpoint, root]));
  }
});
