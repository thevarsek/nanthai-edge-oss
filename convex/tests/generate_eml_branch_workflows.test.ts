import assert from "node:assert/strict";
import test from "node:test";

import { generateEml } from "../tools/generate_eml";

test("generateEml validates required email inputs", async () => {
  const ctx = {
    userId: "user_1",
    ctx: {
      storage: {
        store: async () => "storage_1",
        getUrl: async () => "https://files.example/email.eml",
      },
    },
  } as any;

  const missingFrom = await generateEml.execute(ctx, {
    to: [{ email: "dino@example.com" }],
    subject: "Subject",
    body_text: "Body",
  });
  assert.equal(missingFrom.success, false);
  assert.match(missingFrom.error ?? "", /from_email/);

  const emptyTo = await generateEml.execute(ctx, {
    from_email: "bot@example.com",
    to: [],
    subject: "Subject",
    body_text: "Body",
  });
  assert.equal(emptyTo.success, false);
  assert.match(emptyTo.error ?? "", /non-empty array/);

  const missingSubject = await generateEml.execute(ctx, {
    from_email: "bot@example.com",
    to: [{ email: "dino@example.com" }],
    body_text: "Body",
  });
  assert.equal(missingSubject.success, false);
  assert.match(missingSubject.error ?? "", /subject/);

  const missingBody = await generateEml.execute(ctx, {
    from_email: "bot@example.com",
    to: [{ email: "dino@example.com" }],
    subject: "Subject",
  });
  assert.equal(missingBody.success, false);
  assert.match(missingBody.error ?? "", /body_text/);
});

test("generateEml writes plain text email with safe headers and site download URL", async () => {
  const originalSiteUrl = process.env.CONVEX_SITE_URL;
  process.env.CONVEX_SITE_URL = "https://nanthai.example";

  const stored: Blob[] = [];
  try {
    const result = await generateEml.execute(
      {
        userId: "user_1",
        ctx: {
          storage: {
            store: async (blob: Blob) => {
              stored.push(blob);
              return "storage/plain 1";
            },
            getUrl: async () => {
              throw new Error("site URL should be used instead");
            },
          },
        },
      } as any,
      {
        from_name: 'Nanth "Ops"',
        from_email: "bot@nanth.ai",
        to: [{ email: "dino@example.com" }],
        subject: " \n?! ",
        body_text: "Plain text body",
      },
    );

    assert.equal(result.success, true);
    assert.equal((result.data as any).filename, "email.eml");
    assert.equal(
      (result.data as any).downloadUrl,
      "https://nanthai.example/download?storageId=storage%2Fplain%201&filename=email.eml",
    );
    assert.equal(stored.length, 1);

    const contents = await stored[0]!.text();
    assert.match(contents, /From: "Nanth \\"Ops\\"" <bot@nanth.ai>/);
    assert.match(contents, /Subject:/);
    assert.match(contents, /Content-Type: text\/plain; charset=utf-8/i);
    assert.doesNotMatch(contents, /multipart\/alternative/);
    assert.match(contents, /\r\n\r\nPlain text body\r\n$/);
  } finally {
    if (originalSiteUrl === undefined) {
      delete process.env.CONVEX_SITE_URL;
    } else {
      process.env.CONVEX_SITE_URL = originalSiteUrl;
    }
  }
});
