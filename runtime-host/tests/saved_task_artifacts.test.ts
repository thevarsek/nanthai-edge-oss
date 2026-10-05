import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { materializeRuntimeParts } from "../src/runtime_part_materializer.ts";
import { runtimePartPath } from "../src/runtime_part_paths.ts";
import { runtimePacket, fetchedPartBase } from "./fixtures/runtime_packet.ts";
import { atomicJson } from "../src/saved_task_store.ts";
const capabilities = { inputModalities: ["text", "local_image"] as const, transport: "stdio_jsonrpc" };

test("saved attachment bytes are verified locally after their online fetch handle expired", async () => {
  const root = await mkdtemp(join(tmpdir(), "nanthai-cached-"));
  const bytes = Buffer.from("verified saved image");
  const part = { type: "image" as const, ...fetchedPartBase(), mimeType: "image/png", altText: null };
  part.fetch.expiresAt = 1;
  part.fetch.byteLength = bytes.length;
  part.fetch.sha256 = createHash("sha256").update(bytes).digest("hex");
  const packet = runtimePacket([part]);
  try {
    await writeFile(runtimePartPath(root, part), bytes);
    const parts = await materializeRuntimeParts(packet, capabilities, undefined, new AbortController().signal, { cachedDirectory: root });
    assert.ok(parts.directory);
    assert.deepEqual(await readFile(runtimePartPath(parts.directory, part)), bytes);
    await parts.dispose();
    await writeFile(runtimePartPath(root, part), "changed bytes");
    await assert.rejects(materializeRuntimeParts(packet, capabilities, undefined, new AbortController().signal, { cachedDirectory: root }), /no longer matches/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("failed atomic replacement preserves the previous committed checkpoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "nanthai-atomic-"));
  try {
    const path = join(root, "checkpoint.json");
    await atomicJson(path, { committed: true });
    const original = await readFile(path, "utf8");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await assert.rejects(atomicJson(path, cyclic));
    assert.equal(await readFile(path, "utf8"), original);
    await mkdir(join(root, "blocked"));
    await assert.rejects(atomicJson(join(root, "blocked"), { replacement: true }));
  } finally { await rm(root, { recursive: true, force: true }); }
});
