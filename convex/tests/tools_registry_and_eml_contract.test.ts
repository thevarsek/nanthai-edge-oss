import assert from "node:assert/strict";
import test from "node:test";

import { generateEml } from "../tools/generate_eml";
import { readEml } from "../tools/read_eml";
import {
  checkClozeConnection,
  checkGmailManualConnection,
  checkAppleCalendarConnection,
  checkMicrosoftConnection,
  checkNotionConnection,
  checkSlackConnection,
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

test("readEml covers invalid, empty, HTML, encoded, duplicate, and large bodies", async () => {
  const invalid = await readEml.execute(
    {
      userId: "user_1",
      ctx: { storage: { get: async () => { throw new Error("bad id"); } } },
    } as any,
    { storageId: "bad" },
  );
  assert.equal(invalid.success, false);
  assert.match(invalid.error ?? "", /Invalid storageId/);

  const missing = await readEml.execute(
    { userId: "user_1", ctx: { storage: { get: async () => null } } } as any,
    { storageId: "missing" },
  );
  assert.equal(missing.success, false);
  assert.match(missing.error ?? "", /File not found/);

  const empty = await readEml.execute(
    { userId: "user_1", ctx: { storage: { get: async () => new Blob(["  \n "]) } } } as any,
    { storageId: "empty" },
  );
  assert.equal(empty.success, true);
  assert.equal((empty.data as any).message, "The .eml file is empty.");

  const htmlOnly = await readEml.execute(
    {
      userId: "user_1",
      ctx: {
        storage: {
          get: async () => new Blob([
            [
              "From: Ada <ada@example.com>",
              "To: Team <team@example.com>",
              "Subject: HTML",
              "Content-Type: text/html",
              "",
              "<style>.x{}</style><script>x()</script><p>Hello&nbsp;&amp;&nbsp;goodbye<br>next</p>",
            ].join("\r\n"),
          ]),
        },
      },
    } as any,
    { storageId: "html" },
  );
  assert.equal(htmlOnly.success, true);
  assert.equal((htmlOnly.data as any).body, "Hello & goodbye\nnext");
  assert.equal((htmlOnly.data as any).hasHtmlBody, true);

  const encoded = await readEml.execute(
    {
      userId: "user_1",
      ctx: {
        storage: {
          get: async () => new Blob([
            [
              "From: first@example.com",
              "From: duplicate@example.com",
              "To: you@example.com",
              "Subject: =?utf-8?Q?ignored?=",
              "Content-Type: multipart/alternative; boundary=\"b1\"",
              "",
              "--b1",
              "Content-Type: text/plain",
              "Content-Transfer-Encoding: quoted-printable",
              "",
              "Hello=20soft=\r\nline",
              "--b1",
              "Content-Type: text/html",
              "Content-Transfer-Encoding: base64",
              "",
              "PGI+SFRNTDwvYj4=",
              "--b1--",
            ].join("\r\n"),
          ]),
        },
      },
    } as any,
    { storageId: "encoded" },
  );
  assert.equal(encoded.success, true);
  assert.equal((encoded.data as any).from, "first@example.com, duplicate@example.com");
  assert.equal((encoded.data as any).body, "Hello softline");
  assert.equal((encoded.data as any).headerCount, 4);

  const malformedBase64 = await readEml.execute(
    {
      userId: "user_1",
      ctx: {
        storage: {
          get: async () => new Blob([
            [
              "Content-Type: text/html",
              "Content-Transfer-Encoding: base64",
              "",
              "not valid base64%%%<p>fallback</p>",
            ].join("\n"),
          ]),
        },
      },
    } as any,
    { storageId: "bad_base64" },
  );
  assert.equal(malformedBase64.success, true);
  assert.match(String((malformedBase64.data as any).body), /fallback/);

  const large = await readEml.execute(
    {
      userId: "user_1",
      ctx: {
        storage: {
          get: async () => new Blob([`Subject: Large\n\n${"x".repeat(50_001)}`]),
        },
      },
    } as any,
    { storageId: "large" },
  );
  assert.equal(large.success, true);
  assert.match(String((large.data as any).warning), /large/);
});

test("tool connection helpers return granted integrations and tolerate query failures", async () => {
  const integrations = await getGrantedGoogleIntegrations(
    {
      runQuery: async () => ({
        status: "active",
        scopes: [
          "https://www.googleapis.com/auth/drive.file",
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
  const gmailManual = await checkGmailManualConnection(
    { runQuery: async () => ({ status: "active" }) } as any,
    "user_1",
  );
  const clozeInactive = await checkClozeConnection(
    { runQuery: async () => ({ status: "expired" }) } as any,
    "user_1",
  );
  const slackThrows = await checkSlackConnection(
    { runQuery: async () => { throw new Error("offline"); } } as any,
    "user_1",
  );

  assert.deepEqual(integrations, ["drive"]);
  assert.equal(microsoft, true);
  assert.equal(notion, false);
  assert.equal(apple, false);
  assert.equal(gmailManual, true);
  assert.equal(clozeInactive, false);
  assert.equal(slackThrows, false);
});

test("progressive registry profiles add only the tools unlocked by profile and runtime", () => {
  const registry = new ToolRegistry();
  const presentationRegistry = new ToolRegistry();

  registerProfileTools(presentationRegistry, "presentations", {
    isPro: true,
    allowSubagents: false,
    enabledIntegrations: [],
  });

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
  assert.ok(presentationRegistry.get("create_presentation"));
  assert.ok(presentationRegistry.get("read_pptx"));
  assert.equal(presentationRegistry.get("generate_pptx"), undefined);
});
