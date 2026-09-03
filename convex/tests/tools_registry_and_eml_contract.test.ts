import assert from "node:assert/strict";
import test from "node:test";
import { simpleParser } from "mailparser";

import { generateEml } from "../tools/generate_eml";
import { driveUpload } from "../tools/google/drive";
import { onedriveUpload } from "../tools/microsoft/onedrive";
import { readEml } from "../tools/read_eml";
import {
  registerBaseTools,
  registerProfileTools,
} from "../tools/progressive_registry_profiles";
import { ToolRegistry } from "../tools/registry";
import { CREATE_SKILL_SKILL } from "../skills/catalog/create_skill";
import { DOCUMENTS_SKILL } from "../skills/catalog/documents";
import { GOOGLE_DRIVE_SKILL } from "../skills/catalog/google_drive";
import { GOOGLE_WORKSPACE_SKILL } from "../skills/catalog/google_workspace";
import { MICROSOFT_365_SKILL } from "../skills/catalog/microsoft_365";

test("generateEml and readEml round-trip multipart email content", async () => {
  const stored: Blob[] = [];

  const generated = await generateEml.execute(
    {
      userId: "user_1",
      ctx: {
        runQuery: async () => [{
          storageId: "asset_1",
          filename: "generated-image.png",
          mimeType: "image/png",
          sizeBytes: 11,
        }],
        storage: {
          store: async (blob: Blob) => {
            stored.push(blob);
            return "storage_1";
          },
          getUrl: async (storageId: string) => storageId === "asset_1"
            ? "data:image/png;base64,aW1hZ2UtYnl0ZXM="
            : "https://files.example/email.eml",
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
      attachments: [{ storage_id: "asset_1" }],
    },
  );

  assert.equal(generated.success, true);
  assert.equal((generated.data as any).filename, "Quarterly Update.eml");
  assert.equal((generated.data as any).attachmentCount, 1);
  assert.equal(stored.length, 1);

  const mime = await simpleParser(Buffer.from(await stored[0]!.arrayBuffer()));
  assert.equal(mime.attachments.length, 1);
  assert.equal(mime.attachments[0]?.filename, "generated-image.png");
  assert.equal(mime.attachments[0]?.content.toString(), "image-bytes");

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
  assert.equal((parsed.data as any).from, "NanthAI <bot@nanth.ai>");
  assert.equal((parsed.data as any).to, "Dino <dino@example.com>");
  assert.equal((parsed.data as any).cc, "team@example.com");
  assert.equal((parsed.data as any).subject, "Quarterly Update");
  assert.equal((parsed.data as any).body, "Plain text body");
  assert.equal((parsed.data as any).hasHtmlBody, true);
});

test("generateEml and readEml preserve Unicode headers and quoted-printable text", async () => {
  let stored: Blob | undefined;
  const toolCtx = {
    userId: "user_1",
    ctx: {
      runQuery: async () => [],
      storage: {
        store: async (blob: Blob) => {
          stored = blob;
          return "storage_unicode";
        },
        getUrl: async () => "https://files.example/unicode.eml",
      },
    },
  } as any;
  const subject = "Caffè e città – aggiornamento";
  const body = "Buongiorno, ecco l’aggiornamento di oggi: tutto è pronto.";

  const generated = await generateEml.execute(toolCtx, {
    from_name: "NanthAI",
    from_email: "bot@nanth.ai",
    to: [{ name: "Dino", email: "dino@example.com" }],
    subject,
    body_text: body,
  });
  assert.equal(generated.success, true);
  assert.ok(stored);

  const parsed = await readEml.execute({
    userId: "user_1",
    ctx: { storage: { get: async () => stored } },
  } as any, { storageId: "storage_unicode" });

  assert.equal(parsed.success, true);
  assert.equal((parsed.data as any).subject, subject);
  assert.equal((parsed.data as any).body, body);
});

test("readEml decodes an unencoded 8-bit body with its declared charset", async () => {
  const header = new TextEncoder().encode([
    "From: sender@example.com",
    "To: reader@example.com",
    "Subject: Latin body",
    "Content-Type: text/plain; charset=iso-8859-1",
    "Content-Transfer-Encoding: 8bit",
    "",
    "",
  ].join("\r\n"));
  const body = Uint8Array.from([0x43, 0x61, 0x66, 0xe9]);
  const bytes = new Uint8Array(header.length + body.length);
  bytes.set(header);
  bytes.set(body, header.length);

  const parsed = await readEml.execute({
    userId: "user_1",
    ctx: { storage: { get: async () => new Blob([bytes]) } },
  } as any, { storageId: "latin_1" });

  assert.equal(parsed.success, true);
  assert.equal((parsed.data as any).body, "Café");
});

test("readEml preserves raw UTF-8 headers", async () => {
  const parsed = await readEml.execute({
    userId: "user_1",
    ctx: {
      storage: {
        get: async () => new Blob([[
          "From: José <jose@example.com>",
          "To: Zoë <zoe@example.com>",
          "Subject: Caffè in città",
          "Content-Type: text/plain; charset=utf-8",
          "",
          "Buongiorno",
        ].join("\r\n")]),
      },
    },
  } as any, { storageId: "utf8_headers" });

  assert.equal(parsed.success, true);
  assert.equal((parsed.data as any).from, "José <jose@example.com>");
  assert.equal((parsed.data as any).to, "Zoë <zoe@example.com>");
  assert.equal((parsed.data as any).subject, "Caffè in città");
});

test("readEml reads transfer encoding only from its named MIME header", async () => {
  const parse = async (headers: string[], body: string) => await readEml.execute({
    userId: "user_1",
    ctx: {
      storage: {
        get: async () => new Blob([[...headers, "", body].join("\r\n")]),
      },
    },
  } as any, { storageId: "misleading_header" });

  const quotedPrintableSubject = await parse([
    "Subject: quoted-printable account",
    "Content-Type: text/plain; charset=utf-8",
  ], "Balance=A3");
  const base64Extension = await parse([
    "Subject: Ordinary message",
    "X-Delivery-Mode: base64",
    "Content-Type: text/plain; charset=utf-8",
  ], "SGVsbG8=");

  assert.equal((quotedPrintableSubject.data as any).body, "Balance=A3");
  assert.equal((base64Extension.data as any).body, "SGVsbG8=");
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
  assert.equal((encoded.data as any).subject, "ignored");
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

test("document and cloud skills expose real generated-media reuse paths", () => {
  assert.equal(driveUpload.definition.type, "function");
  assert.equal(onedriveUpload.definition.type, "function");
  if (driveUpload.definition.type !== "function" || onedriveUpload.definition.type !== "function") {
    throw new Error("Cloud upload tools must use function definitions.");
  }
  const driveDescription = driveUpload.definition.function.description;
  const onedriveDescription = onedriveUpload.definition.function.description;

  assert.match(driveDescription, /document or media asset/);
  assert.match(onedriveDescription, /document or media asset/);
  assert.match(GOOGLE_DRIVE_SKILL.instructionsRaw ?? "", /images, audio, or video/);
  assert.match(GOOGLE_DRIVE_SKILL.instructionsRaw ?? "", /filename extension that matches/);
  assert.match(GOOGLE_WORKSPACE_SKILL.instructionsRaw ?? "", /generated media as attachments/);
  assert.match(MICROSOFT_365_SKILL.instructionsRaw ?? "", /onedrive_upload/);
  assert.match(DOCUMENTS_SKILL.instructionsRaw ?? "", /generated-media storage IDs/);

  const creatorInstructions = CREATE_SKILL_SKILL.instructionsRaw ?? "";
  for (const toolName of [
    "generate_image",
    "generate_music",
    "generate_speech",
    "generate_video",
  ]) {
    assert.match(creatorInstructions, new RegExp(`\\b${toolName}\\b`));
  }
});
