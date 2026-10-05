import { createHash } from "node:crypto";
import { chmod, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CodexTransportCapabilities } from "./codex_transport.ts";
import {
  PacketTranslationError,
  preflightRuntimePartModalities,
} from "./packet_translation.ts";
import type {
  LocalRuntimeTurnPacket,
  RuntimeContentPart,
} from "./protocol.ts";
import type { RuntimePartFetcher } from "./runtime_part_fetcher.ts";
import { runtimePartPath } from "./runtime_part_paths.ts";

type FetchedRuntimePart = Exclude<RuntimeContentPart, { type: "text" }>;

export type MaterializedRuntimeParts = {
  directory: string | null;
  dispose(): Promise<void>;
};

export type RuntimePartMaterializerOptions = {
  temporaryRoot?: string;
  cachedDirectory?: string;
  now?: () => number;
};

export async function materializeRuntimeParts(
  packet: LocalRuntimeTurnPacket,
  capabilities: Pick<CodexTransportCapabilities, "inputModalities"> & { transport: string },
  fetcher: RuntimePartFetcher | undefined,
  signal: AbortSignal,
  options: RuntimePartMaterializerOptions = {},
): Promise<MaterializedRuntimeParts> {
  const parts = packet.messages.flatMap((message) => message.content)
    .filter((part): part is FetchedRuntimePart => part.type !== "text");
  preflightRuntimePartModalities(parts, capabilities);
  if (parts.length === 0) return emptyMaterialization();
  if (fetcher === undefined && options.cachedDirectory === undefined) {
    throw new PacketTranslationError(
      "attachment_resolver_unavailable",
      "No authorized attachment fetcher is available",
      parts[0]?.partId ?? null,
    );
  }
  const directory = await mkdtemp(join(options.temporaryRoot ?? tmpdir(), "nanthai-parts-"));
  try {
    const paths = new Set<string>();
    for (const part of parts) {
      const path = runtimePartPath(directory, part);
      if (paths.has(path)) continue;
      paths.add(path);
      if (options.cachedDirectory) {
        signal.throwIfAborted();
        const bytes = await readFile(runtimePartPath(options.cachedDirectory, part));
        if (bytes.byteLength !== part.fetch.byteLength || createHash("sha256").update(bytes).digest("hex") !== part.fetch.sha256) {
          throw translationError("attachment_hash_mismatch", "Saved attachment no longer matches its checkpoint", part);
        }
        await writeFile(path, bytes, { mode: 0o400, flag: "wx" });
      } else {
        await materializePart(path, part, fetcher!, signal, options.now ?? Date.now);
      }
    }
    return disposableMaterialization(directory);
  } catch (error) {
    await removeDirectory(directory);
    throw error;
  }
}

async function materializePart(
  path: string,
  part: FetchedRuntimePart,
  fetcher: RuntimePartFetcher,
  signal: AbortSignal,
  now: () => number,
): Promise<void> {
  if (part.fetch.expiresAt <= now()) {
    throw translationError("attachment_fetch_expired", "Attachment fetch handle expired", part);
  }
  if (part.fetch.byteLength === 0) {
    throw translationError("attachment_length_mismatch", "Attachment bytes cannot be empty", part);
  }
  const file = await open(path, "wx", 0o600);
  const digest = createHash("sha256");
  let offset = 0;
  try {
    while (offset < part.fetch.byteLength) {
      if (part.fetch.expiresAt <= now()) {
        throw translationError("attachment_fetch_expired", "Attachment fetch handle expired", part);
      }
      const maxBytes = Math.min(part.fetch.maxChunkBytes, part.fetch.byteLength - offset);
      const chunk = await fetcher.fetchChunk({
        fetch: part.fetch,
        mimeType: part.mimeType,
        offset,
        maxBytes,
      }, signal);
      if (chunk.byteLength === 0) {
        throw translationError(
          "attachment_length_mismatch", "Attachment fetch ended before its declared length", part,
        );
      }
      if (chunk.byteLength > maxBytes) {
        throw translationError(
          "attachment_chunk_bound_exceeded", "Attachment fetch exceeded its chunk bound", part,
        );
      }
      await writeAll(file, chunk);
      digest.update(chunk);
      offset += chunk.byteLength;
    }
  } finally {
    await file.close();
  }
  if (offset !== part.fetch.byteLength) {
    throw translationError(
      "attachment_length_mismatch", "Attachment bytes do not match the declared length", part,
    );
  }
  if (digest.digest("hex") !== part.fetch.sha256) {
    throw translationError(
      "attachment_hash_mismatch", "Attachment bytes do not match the canonical SHA-256", part,
    );
  }
  await chmod(path, 0o400);
}

async function writeAll(file: Awaited<ReturnType<typeof open>>, bytes: Uint8Array): Promise<void> {
  let written = 0;
  while (written < bytes.byteLength) {
    const result = await file.write(bytes, written, bytes.byteLength - written);
    if (result.bytesWritten === 0) throw new Error("Runtime attachment file write made no progress");
    written += result.bytesWritten;
  }
}

function translationError(code: string, message: string, part: FetchedRuntimePart) {
  return new PacketTranslationError(code, message, part.partId);
}

function emptyMaterialization(): MaterializedRuntimeParts {
  return { directory: null, async dispose() {} };
}

function disposableMaterialization(directory: string): MaterializedRuntimeParts {
  let disposed = false;
  return {
    directory,
    async dispose() {
      if (disposed) return;
      disposed = true;
      await removeDirectory(directory);
    },
  };
}

async function removeDirectory(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}
