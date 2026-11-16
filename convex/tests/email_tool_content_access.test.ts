import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import MailComposer from "nodemailer/lib/mail-composer";

import { generateEml } from "../tools/generate_eml";
import { gmailCreateDraft, gmailSend } from "../tools/google/gmail";

const storeCtx = (stored: Blob[]) => ({
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
}) as any;

const gmailCtx = () => ({
  userId: "user_1",
  ctx: { runQuery: async () => assert.fail("must reject before loading credentials") },
}) as any;

const base = { from_email: "bot@example.com", to: [{ email: "dino@example.com" }], subject: "S", body_text: "B" };

test("generateEml rejects non-string content that nodemailer would resolve from disk or network", async () => {
  const stored: Blob[] = [];
  for (const args of [
    { ...base, body_html: { path: "/proc/self/environ" } },
    { ...base, body_html: { href: "http://169.254.169.254/latest/meta-data/" } },
    { ...base, from_name: { path: "/etc/hosts" } },
    { ...base, to: [{ email: { path: "/etc/hosts" } }] },
    { ...base, cc: [{ email: "a@example.com", name: { href: "http://internal/" } }] },
  ]) {
    const result = await generateEml.execute(storeCtx(stored), args);
    assert.equal(result.success, false, JSON.stringify(args));
  }
  assert.equal(stored.length, 0);
});

test("Gmail send and draft reject non-string body, recipients and subject", async () => {
  for (const tool of [gmailSend, gmailCreateDraft]) {
    for (const args of [
      { to: "a@example.com", subject: "S", body: { path: "/proc/self/environ" } },
      { to: "a@example.com", subject: "S", body: { href: "http://internal/" }, is_html: true },
      { to: { path: "/etc/hosts" }, subject: "S", body: "B" },
      { to: "a@example.com", subject: "S", body: "B", cc: { path: "/etc/hosts" } },
    ]) {
      const result = await tool.execute(gmailCtx(), args);
      assert.equal(result.success, false);
    }
  }
});

test("nodemailer refuses file and URL content when access is disabled", async () => {
  const marker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "eml-")), "marker.txt");
  fs.writeFileSync(marker, "SECRET_MARKER");
  for (const html of [{ path: marker }, { href: "http://127.0.0.1:9/" }]) {
    const build = new MailComposer({
      from: "a@example.com", to: "b@example.com", subject: "S", text: "B", html,
      disableFileAccess: true, disableUrlAccess: true,
    } as any).compile().build();
    await assert.rejects(build);
  }
  const allowed = await new MailComposer({ from: "a@example.com", to: "b@example.com", subject: "S", text: "B", html: { path: marker } } as any)
    .compile().build();
  assert.match(allowed.toString(), /SECRET_MARKER/, "control: without the flags nodemailer reads the file");
});
