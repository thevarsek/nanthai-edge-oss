import { z } from "zod";
import { PublishResultSchema } from "../runtime_host/bridge_contract";

const id = z.string().min(1);
const callId = z.string().min(1).max(256).describe("A unique operation ID. Reuse the same ID and arguments when retrying this operation.");
export const toolDefinitions = [
  { name: "nanthai_list_chats", scope: "history:read", description: "Find your NanthAI conversations. Uses the normal bounded chat list and search.", schema: z.strictObject({ searchQuery: z.string().optional(), limit: z.number().optional() }), readOnly: true },
  { name: "nanthai_read_chat", scope: "history:read", description: "Read saved messages and current execution status in an owned NanthAI chat. before paginates older messages. Does not read private runtime history.", schema: z.strictObject({ chatId: id, before: z.number().optional(), limit: z.number().optional() }), readOnly: true },
  { name: "nanthai_read_artifacts", scope: "history:read", description: "Get published result links for a saved message in your NanthAI account.", schema: z.strictObject({ messageId: id }), readOnly: true },
  { name: "nanthai_list_personas", scope: "chat:write", description: "Find your Personas to select the intended cloud or local route before starting a chat.", schema: z.strictObject({}), readOnly: true },
  { name: "nanthai_create_chat", scope: "chat:write", description: "Create a conversation with a selected owned Persona. Does not generate a response until send_message is called.", schema: z.strictObject({ callId, personaId: id, title: z.string().optional() }), readOnly: false },
  { name: "nanthai_send_message", scope: "chat:write", description: "Send a turn to an owned chat. Normal routing, tools, subscription and costs apply. Local work requires a ready online Mac. Read the saved chat to follow its result.", schema: z.strictObject({ callId, chatId: id, text: z.string().min(1) }), readOnly: false },
  { name: "nanthai_publish_result", scope: "results:write", description: "Deliberately publish a text, Markdown, CSV or JSON report into an owned chat. Only publish material intended for that conversation. This records external work without inventing NanthAI model usage.", schema: PublishResultSchema.extend({ callId, chatId: id }), readOnly: false },
  { name: "nanthai_list_jobs", scope: "jobs:run", description: "Find your existing scheduled jobs. This connection cannot create or edit schedules.", schema: z.strictObject({}), readOnly: true },
  { name: "nanthai_run_job", scope: "jobs:run", description: "Run an existing owned scheduled job now, using its normal readiness, overlap and permission behavior.", schema: z.strictObject({ callId, jobId: id }), readOnly: false },
  { name: "nanthai_stop_run", scope: "runs:stop", description: "Stop an owned active execution run using NanthAI cancellation and runtime teardown. Completed results remain available.", schema: z.strictObject({ callId, runId: id }), readOnly: false },
] as const;

export function findTool(name: string) {
  return toolDefinitions.find(tool => tool.name === name);
}
export function toolsForScopes(scopes: string[]) {
  return toolDefinitions.filter(tool => scopes.includes(tool.scope)).map(tool => ({
    name: tool.name, description: tool.description, inputSchema: z.toJSONSchema(tool.schema),
    annotations: { readOnlyHint: tool.readOnly, destructiveHint: tool.name === "nanthai_stop_run", idempotentHint: true, openWorldHint: false },
  }));
}
