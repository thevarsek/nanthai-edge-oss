import { fileURLToPath } from "node:url";
import { OwnedProcess } from "../src/process_tree.ts";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexWorkerBackend } from "../src/codex_worker_backend.ts";
import { resolveCodexCommand, verifyCodexVersion } from "../src/codex_executable.ts";
import { computePacketHash } from "../src/packet_integrity.ts";
import { BRIDGE_TOOLS, type LocalRuntimeTurnPacket } from "../src/protocol.ts";
import { runtimePacket } from "../tests/fixtures/runtime_packet.ts";

if (!process.argv.includes("--confirm-personal-subscription-use")) throw new Error("Explicit personal subscription use confirmation is required");
// The parent owns the group, including native notification helpers after Codex exits.
if (!process.argv.includes("--owned-child")) {
  const owned = OwnedProcess.spawn({ command: process.execPath, args: ["--import", "tsx", fileURLToPath(import.meta.url), ...process.argv.slice(2), "--owned-child"] });
  owned.child.stdout.pipe(process.stdout);
  owned.child.stderr.pipe(process.stderr);
  owned.child.stdin.end();
  let code = 1;
  try { code = (await owned.exit).code ?? 1; } finally { await owned.terminate(); }
  process.exit(code);
}
const command = await resolveCodexCommand();
const version = await verifyCodexVersion(command);
const cwd = await mkdtemp(join(tmpdir(), "nanthai-m45-smoke-"));
const backend = new CodexWorkerBackend({ transport: "app_server_stdio", codexCommand: command, sandboxMode: "read-only", workingDirectory: cwd });
let toolCalls = 0;
backend.bindTools(async () => {
  toolCalls += 1;
  return { success: true, contentItems: [{ type: "inputText", text: "Authorized smoke context: token M45_ORCHID" }] };
});
const timeout = setTimeout(() => { void backend.shutdown(); }, 90_000);
try {
  const first = packet("Read nanthai_read_context, remember its token, and reply only with that token. Do not use other tools.");
  first.capabilities.nanthaiTools = [{ id: "nanthai_read_context", name: "nanthai_read_context", version: "1", effect: "read", inputSchemaHash: createHash("sha256").update(JSON.stringify(BRIDGE_TOOLS[0]!.inputSchema)).digest("hex") }];
  first.command.packetHash = computePacketHash(first);
  const a = await run(first, null);
  assert.ok(a.text.includes("M45_ORCHID"));
  assert.equal(toolCalls, 1);
  const second = packet("What token did you remember? Reply only with that token. Do not use tools.");
  const b = await run(second, a.nativeId, a.turnId);
  assert.equal(b.nativeId, a.nativeId);
  assert.ok(b.text.includes("M45_ORCHID"));
  // The original frontier is now stale: it must not import this intervening turn.
  const third = packet("Reply exactly REBUILT_OK. Do not use tools.");
  const c = await run(third, a.nativeId, a.turnId);
  assert.notEqual(c.nativeId, a.nativeId);
  assert.equal(c.replacement, "native_frontier_changed");
  assert.ok(c.text.includes("REBUILT_OK"));
  const cancelling = await backend.open(packet("Count from 1 to 1000, one number per line. Start immediately. Do not use tools."), "cancel-smoke", null);
  let cancelRequested = false;
  let cancelled = false;
  for await (const event of backend.sendTurn(cancelling.session)) {
    if (event.type === "text_delta" && !cancelRequested) {
      cancelRequested = true;
      await backend.cancel(cancelling.session);
    }
    if (event.type === "terminal") cancelled = event.outcome === "cancelled";
  }
  assert.ok(cancelRequested, "Real streamed output must arrive before cancellation");
  assert.ok(cancelled, "Native cancellation must settle as cancelled");
  await backend.close(cancelling.session);
  console.log(JSON.stringify({ version, model: a.model, toolCalls, continuation: "passed", externalAdvancementRebuild: "passed", streamingCancellation: "passed" }));
} finally {
  clearTimeout(timeout);
  await backend.shutdown();
  await rm(cwd, { recursive: true, force: true });
}
function packet(text: string): LocalRuntimeTurnPacket {
  const value = runtimePacket([{ type: "text", partId: "part-1", text }]);
  value.placement.adapter.adapterVersion = version;
  value.command.packetHash = computePacketHash(value);
  return value;
}
async function run(value: LocalRuntimeTurnPacket, nativeId: string | null, turnId?: string) {
  const opened = await backend.open(value, value.attemptId, nativeId,
    turnId ? { expectedNativeTurnId: turnId, deliveredMessageIds: [] } : undefined);
  let text = ""; let nativeTurnId: string | null | undefined; let outcome; let model;
  for await (const event of backend.sendTurn(opened.session)) {
    if (event.type === "text_delta") text += event.delta;
    if (event.type === "model_observed") model = event.actualModel.modelId;
    if (event.type === "permission_requested") await backend.respondToPermission(opened.session, event.permissionRequestId, "deny");
    if (event.type === "input_requested") await backend.respondToInput(opened.session, event.inputRequestId, { outcome: "cancelled", content: null });
    if (event.type === "terminal") { outcome = event.outcome; nativeTurnId = event.nativeTurnId; if (outcome !== "completed") console.log(event.summary); }
  }
  assert.equal(outcome, "completed"); assert.ok(nativeTurnId);
  const id = backend.nativeSessionId(opened.session); assert.ok(id);
  await backend.close(opened.session);
  return { text, nativeId: id, turnId: nativeTurnId, model, replacement: opened.replacementReason };
}
