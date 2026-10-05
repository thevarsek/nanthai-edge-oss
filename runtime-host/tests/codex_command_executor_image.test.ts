import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CodexCommandExecutor } from "../src/codex_command_executor.ts";
import type { RuntimeCommand, RuntimeEvent } from "../src/control_plane.ts";
import type { RuntimePartFetcher } from "../src/runtime_part_fetcher.ts";
import { runtimePacket } from "./fixtures/runtime_packet.ts";

const fakeServer = fileURLToPath(
  new URL("./fixtures/fake_json_rpc_child.mjs", import.meta.url),
);

test("host materializes an image for App Server and removes it after the turn", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "nanthai-executor-image-"));
  const bytes = Buffer.from("deterministic-png-bytes");
  const packet = runtimePacket([
    { type: "text", partId: "part-text", text: "REPORT_LOCAL_IMAGE" },
    {
      type: "image",
      partId: "part-image",
      name: "example.png",
      mimeType: "image/png",
      altText: "Fixture image",
      fetch: {
        handle: "opaque-image-handle",
        expiresAt: Date.now() + 60_000,
        byteLength: bytes.byteLength,
        maxChunkBytes: 5,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    },
  ]);
  const executor = new CodexCommandExecutor({
    codexCommand: process.execPath,
    codexArgs: [fakeServer],
    sandboxMode: "read-only",
    partFetcher: byteFetcher(bytes),
    partTemporaryRoot: temporaryRoot,
  });
  const events: RuntimeEvent[] = [];
  try {
    await executor.execute(command(packet), async (event) => { events.push(event); },
      new AbortController().signal);
    assert.equal(textDeltas(events).includes("LOCAL_IMAGE_OK"), true);
    assert.deepEqual(await readdir(temporaryRoot), []);
  } finally {
    await executor.shutdown();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

function byteFetcher(bytes: Uint8Array): RuntimePartFetcher {
  return {
    async fetchChunk({ offset, maxBytes }) {
      return bytes.subarray(offset, offset + maxBytes);
    },
  };
}

function command(packet: ReturnType<typeof runtimePacket>): RuntimeCommand {
  return {
    commandRecordId: "record-command-1",
    commandId: packet.command.commandId,
    runId: packet.runId,
    attemptId: packet.attemptId,
    fence: packet.fence,
    kind: "start",
    receivedAtMs: Date.now(),
    payload: {
      type: "start",
      authorizationSource: "paired_device",
      inputHash: "transport-envelope-hash",
      rawPayload: JSON.stringify({ threadName: "Vision · Chat" }),
      turnPacketId: "packet-1",
      packet,
      packetSha256: packet.command.packetHash,
      packetError: null,
    },
  };
}

function textDeltas(events: readonly RuntimeEvent[]): string[] {
  return events.flatMap((event) => {
    const message = event.payload as {
      kind?: string;
      payload?: { event?: { type?: string; delta?: string } };
    };
    return message.kind === "adapter_event" && message.payload?.event?.type === "text_delta"
      && message.payload.event.delta !== undefined ? [message.payload.event.delta] : [];
  });
}
