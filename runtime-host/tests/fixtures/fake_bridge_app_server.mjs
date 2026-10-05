import readline from "node:readline";

if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.153.4\n");
  process.exit(0);
}
const lines = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const reply = (id, result) => send({ id, result });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  switch (message.method) {
    case "initialize": reply(message.id, { userAgent: "fixture" }); return;
    case "initialized": return;
    case "thread/start":
      reply(message.id, { thread: { id: "thread-bridge" }, model: "gpt-test", modelProvider: "openai", cwd: process.cwd() });
      return;
    case "thread/name/set":
    case "thread/inject_items": reply(message.id, {}); return;
    case "turn/start":
      reply(message.id, { turn: { id: "turn-bridge", status: "inProgress", items: [] } });
      send({ id: "bridge-1", method: "item/tool/call", params: {
        threadId: "thread-bridge", turnId: "turn-bridge", callId: "publish-1", tool: "nanthai_publish_result",
        arguments: { filename: "evidence.csv", mimeType: "text/csv", content: "item,value\norchid,45\n" },
      } });
      return;
    default:
      if (message.id !== "bridge-1" || !message.result?.success) throw new Error("Unexpected bridge fixture message");
      send({ method: "item/agentMessage/delta", params: {
        threadId: "thread-bridge", turnId: "turn-bridge", itemId: "answer", delta: "PUBLISHED",
      } });
      send({ method: "turn/completed", params: {
        threadId: "thread-bridge", turn: { id: "turn-bridge", status: "completed", items: [] },
      } });
  }
});
