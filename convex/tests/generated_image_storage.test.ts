import assert from "node:assert/strict";
import test from "node:test";

import { persistGeneratedImagePayload } from "../chat/action_generated_image_storage";

function encoded(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

test("generated SVG storage accepts inert markup and rejects active or external content", async () => {
  const stored: Blob[] = [];
  const context = {
    storage: {
      store: async (blob: Blob) => {
        stored.push(blob);
        return `storage_${stored.length}`;
      },
      getUrl: async (storageId: string) => `https://files.example/${storageId}`,
      delete: async () => undefined,
    },
  };
  const safe = await persistGeneratedImagePayload(context as never, {
    base64: encoded('<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" /></defs><rect fill="url(#g)" /></svg>'),
    mimeType: "image/svg+xml",
  });
  const unsafePayloads = [
    '<svg><script>alert(1)</script></svg>',
    '<svg><image href="https://attacker.test/pixel" /></svg>',
    '<svg><rect style="fill:url(https://attacker.test/pixel)" /></svg>',
    '<!DOCTYPE svg [<!ENTITY leak SYSTEM "https://attacker.test/value">]><svg>&leak;</svg>',
    '<svg></svg><form action="https://attacker.test"><button>Open</button></form>',
  ];
  const unsafe = await Promise.all(unsafePayloads.map(async (markup) =>
    await persistGeneratedImagePayload(context as never, {
      base64: encoded(markup),
      mimeType: "image/svg+xml",
    })
  ));

  assert.ok(safe);
  assert.equal(stored.length, 1);
  assert.deepEqual(unsafe, unsafe.map(() => null));
});

test("generated image storage deletes a blob when URL resolution throws", async () => {
  const deleted: string[] = [];
  const result = await persistGeneratedImagePayload({
    storage: {
      store: async () => "stored_without_url",
      getUrl: async () => {
        throw new Error("temporary URL failure");
      },
      delete: async (storageId: string) => {
        deleted.push(storageId);
      },
    },
  } as never, {
    base64: "AAEC",
    mimeType: "image/png",
  });

  assert.equal(result, null);
  assert.deepEqual(deleted, ["stored_without_url"]);
});
