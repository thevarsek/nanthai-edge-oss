import assert from "node:assert/strict";
import test from "node:test";
import type { MutationCtx } from "../_generated/server";
import {
  deleteInstaller,
  generateInstallerUploadUrl,
  getInstallerUrl,
} from "../runtime_host/installer_storage";

type Handler<Args, Result> = { _handler: (ctx: MutationCtx, args: Args) => Promise<Result> };
const upload = (generateInstallerUploadUrl as unknown as Handler<Record<string, never>, string>)._handler;
const resolveUrl = (getInstallerUrl as unknown as Handler<{ storageId: string }, string>)._handler;
const remove = (deleteInstaller as unknown as Handler<{ storageId: string }, null>)._handler;

function storageCtx(files: Record<string, { contentType?: string }>) {
  const deleted: string[] = [];
  const ctx = {
    db: { system: { get: async (id: string) => files[id] ? { _id: id, ...files[id] } : null } },
    storage: {
      generateUploadUrl: async () => "https://upload.example/installer",
      delete: async (id: string) => { deleted.push(id); },
      getUrl: async (id: string) => `https://files.example/${id}`,
    },
  } as unknown as MutationCtx;
  return { ctx, deleted };
}

test("installer upload returns a storage upload URL", async () => {
  assert.equal(await upload(storageCtx({}).ctx, {}), "https://upload.example/installer");
});

test("installer deletion removes only stored DMGs", async () => {
  const { ctx, deleted } = storageCtx({
    dmg: { contentType: "application/x-apple-diskimage" },
    avatar: { contentType: "image/png" },
  });
  assert.equal(await remove(ctx, { storageId: "dmg" }), null);
  await assert.rejects(remove(ctx, { storageId: "avatar" }), /NOT_AN_INSTALLER/);
  await assert.rejects(remove(ctx, { storageId: "missing" }), /NOT_FOUND/);
  assert.deepEqual(deleted, ["dmg"]);
});

test("installer URL resolves only stored DMGs", async () => {
  const { ctx } = storageCtx({
    dmg: { contentType: "application/x-apple-diskimage" },
    avatar: { contentType: "image/png" },
  });
  assert.equal(await resolveUrl(ctx, { storageId: "dmg" }), "https://files.example/dmg");
  await assert.rejects(resolveUrl(ctx, { storageId: "avatar" }), /NOT_AN_INSTALLER/);
  await assert.rejects(resolveUrl(ctx, { storageId: "missing" }), /NOT_FOUND/);
});
