import assert from "node:assert/strict";
import test from "node:test";

import { generateEml } from "../tools/generate_eml";
import { readEml } from "../tools/read_eml";
import {
  checkAppleCalendarConnection,
  checkMicrosoftConnection,
  checkNotionConnection,
  getGrantedGoogleIntegrations,
} from "../tools/index";
import {
  registerBaseTools,
  registerProfileTools,
} from "../tools/progressive_registry_profiles";
import { ToolRegistry } from "../tools/registry";

test("generateEml and readEml round-trip multipart email content", async () => {
  const stored: Blob[] = [];

  const generated = await generateEml.execute(
    {
      userId: "user_1",
      ctx: {
        storage: {
          store: async (blob: Blob) => {
            stored.push(blob);
            return "storage_1";
          },
          getUrl: async () => "https://files.example/email.eml",
        },
      },
    } as any,
    {
      from_name: "NanthAI",
      from_email: "bot@nanth.ai",
      to: [{ name: "Dino", email: "dino@example.com" }],
      cc: [{ email: "team@example.com" }],
      subject: "Quarterly Update",
      body_text: "Plain text body",
      body_html: "<p><strong>HTML</strong> body</p>",
      date: "2026-01-15T10:30:00Z",
    },
  );

  assert.equal(generated.success, true);
  assert.equal((generated.data as any).filename, "Quarterly Update.eml");
  assert.equal(stored.length, 1);

  const parsed = await readEml.execute(
    {
      userId: "user_1",
      ctx: {
        storage: {
          get: async () => stored[0],
        },
      },
    } as any,
    { storageId: "storage_1" },
  );

  assert.equal(parsed.success, true);
  assert.equal((parsed.data as any).from, '"NanthAI" <bot@nanth.ai>');
  assert.equal((parsed.data as any).to, '"Dino" <dino@example.com>');
  assert.equal((parsed.data as any).cc, "team@example.com");
  assert.equal((parsed.data as any).subject, "Quarterly Update");
  assert.equal((parsed.data as any).body, "Plain text body");
  assert.equal((parsed.data as any).hasHtmlBody, true);
});

test("tool connection helpers return granted integrations and tolerate query failures", async () => {
  const integrations = await getGrantedGoogleIntegrations(
    {
      runQuery: async () => ({
        status: "active",
        scopes: [
          "https://www.googleapis.com/auth/gmail.modify",
          "https://www.googleapis.com/auth/drive",
        ],
      }),
    } as any,
    "user_1",
  );

  const microsoft = await checkMicrosoftConnection(
    { runQuery: async () => ({ status: "active" }) } as any,
    "user_1",
  );
  const notion = await checkNotionConnection(
    { runQuery: async () => null } as any,
    "user_1",
  );
  const apple = await checkAppleCalendarConnection(
    { runQuery: async () => { throw new Error("missing"); } } as any,
    "user_1",
  );

  assert.deepEqual(integrations, ["gmail", "drive"]);
  assert.equal(microsoft, true);
  assert.equal(notion, false);
  assert.equal(apple, false);
});

test("progressive registry profiles add only the tools unlocked by profile and runtime", () => {
  const registry = new ToolRegistry();

  registerBaseTools(registry, false, ["generate_eml"]);
  registerProfileTools(registry, "docs", {
    isPro: true,
    allowSubagents: false,
    enabledIntegrations: [],
  });
  registerProfileTools(registry, "analytics", {
    isPro: true,
    allowSubagents: false,
    enabledIntegrations: [],
  });
  registerProfileTools(registry, "google", {
    isPro: true,
    allowSubagents: false,
    enabledIntegrations: ["gmail"],
  });

  assert.ok(registry.get("fetch_image"));
  assert.ok(registry.get("generate_eml"));
  assert.ok(registry.get("read_docx"));
  assert.ok(registry.get("data_python_exec"));
  assert.ok(registry.get("workspace_import_file"));
  assert.ok(registry.get("gmail_search"));
  assert.equal(registry.get("drive_list"), undefined);
});
