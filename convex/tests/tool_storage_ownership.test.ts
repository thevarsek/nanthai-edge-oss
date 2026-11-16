import assert from "node:assert/strict";
import test from "node:test";

import { editDocx } from "../tools/edit_docx";
import { editPptx } from "../tools/edit_pptx";
import { readDocx } from "../tools/read_docx";
import { readEml } from "../tools/read_eml";
import { readTextFile } from "../tools/read_text_file";
import { getOwnedFileBlob, getOwnedImageBlob } from "../tools/owned_storage_blob";

function foreignStorageCtx() {
  const reads: string[] = [];
  const ownershipChecks: Array<Record<string, unknown>> = [];
  return {
    reads,
    ownershipChecks,
    ctx: {
      // The resolver finds no row owned by this user for the ID.
      runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
        ownershipChecks.push(args);
        return args.storageIds ? [] : null;
      },
      storage: {
        get: async (storageId: string) => {
          reads.push(storageId);
          return new Blob(["victim data"]);
        },
      },
    },
  };
}

const cases = [
  { name: "read_text_file", tool: readTextFile, args: {} },
  { name: "read_docx", tool: readDocx, args: {} },
  { name: "read_eml", tool: readEml, args: {} },
  { name: "edit_docx", tool: editDocx, args: { title: "Replacement", sections: [{ heading: "H", body: "B" }] } },
  { name: "edit_pptx", tool: editPptx, args: { title: "Replacement", slides: [{ title: "Slide" }] } },
];

for (const { name, tool, args } of cases) {
  test(`${name} refuses a storage ID the user does not own without reading the blob`, async () => {
    const state = foreignStorageCtx();
    const result = await tool.execute(
      { userId: "attacker", ctx: state.ctx } as any,
      { ...args, storageId: "victim_storage" },
    );
    assert.equal(result.success, false);
    assert.equal(result.error, "The requested file is not available to this user.");
    assert.deepEqual(state.reads, []);
    assert.deepEqual(state.ownershipChecks, [{ userId: "attacker", storageId: "victim_storage" }]);
  });
}

test("owned blob helpers return the blob only after an ownership match", async () => {
  const blob = new Blob(["mine"]);
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) =>
      args.storageIds ? [{ storageId: "mine" }] : { storageId: "mine", filename: "notes.txt" },
    storage: { get: async () => blob },
  } as any;
  assert.deepEqual(await getOwnedFileBlob(ctx, "user_1", "mine"), { ok: true, blob, filename: "notes.txt" });
  assert.deepEqual(await getOwnedImageBlob(ctx, "user_1", "mine"), { ok: true, blob });

  const missing = { ...ctx, storage: { get: async () => null } };
  assert.match(String((await getOwnedFileBlob(missing, "user_1", "mine") as any).error), /File not found/);
  const invalid = { ...ctx, runQuery: async () => { throw new Error("bad id"); } };
  assert.match(String((await getOwnedFileBlob(invalid, "user_1", "x") as any).error), /Invalid storageId/);
});
