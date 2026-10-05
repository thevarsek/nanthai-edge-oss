import readline from "node:readline";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { clearTimeout } from "node:timers";

if (process.argv.includes("--version")) { console.log("1.0.0"); process.exit(0); }
const args = process.argv;
const value = name => args[args.indexOf(name) + 1];
const nativeId = args.includes("--session-id") ? value("--session-id") : "11111111-1111-4111-8111-111111111111";
const root = args.includes("--session-dir") ? value("--session-dir") : null;
let leaf = null;
if (root) { try { leaf = JSON.parse(await readFile(join(root, nativeId), "utf8")).leaf; } catch { /* New native session. */ } }
let settledTimer;
let pendingPrompt;
const model = { id: "qa-model", name: "QA model", provider: process.env.NANTHAI_TEST_PI_PROVIDER ?? "openrouter", input: process.env.NANTHAI_TEST_TEXT_MODEL ? ["text"] : ["text", "image"], reasoning: true, baseUrl: "https://unused.example/v1" };
const emit = record => process.stdout.write(`${JSON.stringify(record)}\n`);
const reply = (command, data) => emit({ type: "response", id: command.id, command: command.type, success: true, data });
async function settle(text, stopReason = "stop") {
  clearTimeout(settledTimer);
  emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: text } });
  emit({ type: "message_end", message: { role: "assistant", provider: model.provider, model: "qa-model", stopReason,
    usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 0, totalTokens: 17, cost: { total: 0.0001 } } } });
  emit({ type: "agent_end", willRetry: false });
  leaf = `leaf-${Date.now()}`;
  if (root) { await mkdir(root, { recursive: true }); await writeFile(join(root, nativeId), JSON.stringify({ leaf })); }
  settledTimer = setTimeout(() => emit({ type: "agent_settled" }), 40);
}
async function prompt(command) {
  emit({ type: "agent_start" }); emit({ type: "message_start", message: { role: "assistant" } });
  if (command.message.includes("ASK")) {
    pendingPrompt = command;
    emit({ type: "extension_ui_request", id: "question-1", method: "select", title: "Choose a color", options: ["Blue", "Green"] });
  } else if (command.message.includes("BRIDGE")) {
    reply(command, { disposition: "started" });
    const config = JSON.parse(await readFile(process.env.NANTHAI_PI_BRIDGE_CONFIG, "utf8"));
    const response = await globalThis.fetch(config.url, { method: "POST", headers: { Authorization: `Bearer ${config.token}` },
      body: JSON.stringify({ callId: "publish-1", tool: "nanthai_publish_result", arguments: { filename: "qa.md", mimeType: "text/markdown", content: "Pi artifact" } }) });
    await settle(JSON.stringify(await response.json()));
  } else { reply(command, { disposition: "started" }); await settle(`Pi: ${command.message}\u2028unicode\u2029intact`); }
}
const lines = readline.createInterface({ input: process.stdin });
for await (const line of lines) {
  const command = JSON.parse(line);
  switch (command.type) {
    case "get_available_models": reply(command, { models: [model] }); break;
    case "get_state": reply(command, { model, sessionId: nativeId }); break;
    case "get_entries": reply(command, { entries: [], leafId: leaf }); break;
    case "set_model": reply(command, model); break;
    case "set_session_name": reply(command); break;
    case "prompt": void prompt(command); break;
    case "extension_ui_response":
      if (pendingPrompt) { reply(pendingPrompt, { disposition: "started" }); pendingPrompt = null; }
      await settle(command.value ?? "cancelled"); break;
    case "clear_queue": reply(command, { steering: [], followUp: [] }); break;
    case "abort": await settle("stopped", "aborted"); reply(command); break;
    case "echo": reply(command, { text: command.text }); break;
    default: emit({ type: "response", id: command.id, success: false });
  }
}
clearTimeout(settledTimer);
