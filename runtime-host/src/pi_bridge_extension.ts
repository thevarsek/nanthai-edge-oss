/** Loaded in Pi's process alongside its ordinary configured extensions. No SDK in the supervisor. */
export const PI_BRIDGE_EXTENSION = `
import { readFileSync } from "node:fs";
const config = JSON.parse(readFileSync(process.env.NANTHAI_PI_BRIDGE_CONFIG, "utf8"));
export default function(pi) {
  let injected = false;
  pi.on("before_agent_start", (event) => {
    if (!injected && config.history.length) pi.sendMessage({
      customType: "nanthai_canonical_context", content: [], display: false,
      details: { messages: config.history },
    }, { triggerTurn: false });
    injected = true;
    return { systemPrompt: event.systemPrompt + "\\n\\n" + config.instructions };
  });
  pi.on("context", (event) => ({ messages: event.messages.flatMap(message =>
    message.role === "custom" && message.customType === "nanthai_canonical_context"
      ? message.details.messages : [message]) }));
  for (const tool of config.tools) pi.registerTool({
    name: tool.name, label: tool.name, description: tool.description, parameters: tool.inputSchema,
    async execute(callId, args, signal) {
      const response = await fetch(config.url, { method: "POST", signal,
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + config.token },
        body: JSON.stringify({ callId, tool: tool.name, arguments: args }) });
      if (!response.ok) throw new Error("NanthAI bridge request failed");
      const result = await response.json();
      if (result.success === false) throw new Error("NanthAI tool failed: " + String(result.contentItems?.[0]?.text ?? "request rejected"));
      const content = Array.isArray(result.contentItems) ? result.contentItems.map(item => ({ type: "text", text: item.text }))
        : [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }];
      return { content, details: {} };
    },
  });
}
`;
