import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { APP_SERVER_CAPABILITIES } from "../src/codex_capabilities.ts";
import { PacketTranslationError } from "../src/packet_translation.ts";
import type { RuntimeContentPart } from "../src/protocol.ts";
import type {
  RuntimePartChunkRequest,
  RuntimePartFetcher,
} from "../src/runtime_part_fetcher.ts";
import { materializeRuntimeParts } from "../src/runtime_part_materializer.ts";
import { runtimePartPath } from "../src/runtime_part_paths.ts";
import { runtimePacket } from "./fixtures/runtime_packet.ts";

const NOW = 1_786_752_000_000;

test("materializes bounded chunks into a private file and disposes it", async () => {
  const root = await mkdtemp(join(tmpdir(), "nanthai-parts-test-"));
  const bytes = Buffer.from("image-bytes");
  const part = imagePart(bytes, 3);
  const requests: RuntimePartChunkRequest[] = [];
  const materialized = await materializeRuntimeParts(
    runtimePacket([part]),
    APP_SERVER_CAPABILITIES,
    fetcher((request) => {
      requests.push(request);
      return bytes.subarray(request.offset, request.offset + request.maxBytes);
    }),
    new AbortController().signal,
    { temporaryRoot: root, now: () => NOW },
  );
  try {
    assert.deepEqual(requests.map(({ offset, maxBytes }) => ({ offset, maxBytes })), [
      { offset: 0, maxBytes: 3 },
      { offset: 3, maxBytes: 3 },
      { offset: 6, maxBytes: 3 },
      { offset: 9, maxBytes: 2 },
    ]);
    const directory = requireDirectory(materialized.directory);
    const path = runtimePartPath(directory, part);
    assert.deepEqual(await readFile(path), bytes);
    assert.equal((await stat(path)).mode & 0o777, 0o400);
  } finally {
    await materialized.dispose();
    await materialized.dispose();
    assert.deepEqual(await readdir(root), []);
    await rm(root, { recursive: true, force: true });
  }
});

test("removes partial files when the final SHA-256 does not match", async () => {
  const root = await mkdtemp(join(tmpdir(), "nanthai-parts-hash-"));
  const expected = Buffer.from("expected");
  const actual = Buffer.from("tampered");
  await assert.rejects(
    materializeRuntimeParts(
      runtimePacket([imagePart(expected, 4)]),
      APP_SERVER_CAPABILITIES,
      fetcher((request) => actual.subarray(request.offset, request.offset + request.maxBytes)),
      new AbortController().signal,
      { temporaryRoot: root, now: () => NOW },
    ),
    errorCode("attachment_hash_mismatch"),
  );
  assert.deepEqual(await readdir(root), []);
  await rm(root, { recursive: true, force: true });
});

test("rejects an early empty chunk as a length mismatch and cleans up", async () => {
  const root = await mkdtemp(join(tmpdir(), "nanthai-parts-length-"));
  let calls = 0;
  const bytes = Buffer.from("expected");
  await assert.rejects(
    materializeRuntimeParts(
      runtimePacket([imagePart(bytes, 4)]),
      APP_SERVER_CAPABILITIES,
      fetcher((request) => {
        calls += 1;
        return calls === 1 ? bytes.subarray(request.offset, request.offset + 4) : new Uint8Array();
      }),
      new AbortController().signal,
      { temporaryRoot: root, now: () => NOW },
    ),
    errorCode("attachment_length_mismatch"),
  );
  assert.deepEqual(await readdir(root), []);
  await rm(root, { recursive: true, force: true });
});

test("rejects a chunk above the requested bound and cleans up", async () => {
  const root = await mkdtemp(join(tmpdir(), "nanthai-parts-chunk-"));
  const bytes = Buffer.from("expected");
  await assert.rejects(
    materializeRuntimeParts(
      runtimePacket([imagePart(bytes, 2)]),
      APP_SERVER_CAPABILITIES,
      fetcher((request) => bytes.subarray(request.offset, request.offset + request.maxBytes + 1)),
      new AbortController().signal,
      { temporaryRoot: root, now: () => NOW },
    ),
    errorCode("attachment_chunk_bound_exceeded"),
  );
  assert.deepEqual(await readdir(root), []);
  await rm(root, { recursive: true, force: true });
});

test("rejects unsupported modalities before creating a directory or fetching", async () => {
  const root = await mkdtemp(join(tmpdir(), "nanthai-parts-preflight-"));
  let fetched = false;
  const bytes = Buffer.from("document");
  const part: RuntimeContentPart = {
    type: "document",
    ...fetchedFields(bytes, 4),
    mimeType: "application/pdf",
    extractedText: "Visible text does not replace the original document",
  };
  await assert.rejects(
    materializeRuntimeParts(
      runtimePacket([part]),
      APP_SERVER_CAPABILITIES,
      fetcher(() => { fetched = true; return bytes; }),
      new AbortController().signal,
      { temporaryRoot: root, now: () => NOW },
    ),
    errorCode("unsupported_input_modality"),
  );
  assert.equal(fetched, false);
  assert.deepEqual(await readdir(root), []);
  await rm(root, { recursive: true, force: true });
});

function imagePart(bytes: Uint8Array, maxChunkBytes: number) {
  return {
    type: "image" as const,
    ...fetchedFields(bytes, maxChunkBytes),
    mimeType: "image/png",
    altText: null,
  };
}

function fetchedFields(bytes: Uint8Array, maxChunkBytes: number) {
  return {
    partId: "part-image",
    name: "image.png",
    fetch: {
      handle: "opaque-image-handle",
      expiresAt: NOW + 60_000,
      byteLength: bytes.byteLength,
      maxChunkBytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
}

function fetcher(
  resolve: (request: RuntimePartChunkRequest) => Uint8Array,
): RuntimePartFetcher {
  return { async fetchChunk(request) { return resolve(request); } };
}

function errorCode(code: string) {
  return (error: unknown) => error instanceof PacketTranslationError && error.code === code;
}

function requireDirectory(value: string | null): string {
  if (value === null) throw new Error("Expected materialized attachment directory");
  return value;
}
