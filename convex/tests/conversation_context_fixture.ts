import { getFunctionName } from "convex/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import { createPermissionFixture } from "./runtime_host_permission_fixture";
import * as queries from "../chat/conversation_context_queries";
import * as mutations from "../chat/conversation_context_mutations";
import * as native from "../chat/conversation_context_native";
import * as operations from "../execution/operations";

export function invoke<T = unknown>(registration: unknown, ctx: MutationCtx | QueryCtx, args: Record<string, unknown>): Promise<T> {
  return (registration as {_handler: (ctx: MutationCtx | QueryCtx, args: Record<string, unknown>) => Promise<T>})._handler(ctx, args);
}
export async function contextFixture(count = 40) {
  const {ctx, rows} = await createPermissionFixture();
  rows.messages = Array.from({length: count}, (_, index) => ({_id: `source-${index}`, chatId: "chat-1", userId: "user_1",
    role: index % 2 ? "assistant" : "user", content: `sentinel-${index} ${"evidence ".repeat(50)}`, status: "completed",
    parentMessageIds: index ? [`source-${index-1}`] : [], createdAt: index + 1}));
  rows.messages.push({_id: "message-1", chatId: "chat-1", userId: "user_1", role: "assistant", content: "", status: "pending", parentMessageIds: [`source-${count-1}`], createdAt: count+1});
  rows.generationJobs[0].modelId = "test/compact";
  rows.generationJobs[0].chatParticipantId = "participant-1";
  rows.executionAttempts[0].placement = "cloud";
  const registry: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(queries)) registry[`chat/conversation_context_queries:${name}`] = fn;
  for (const [name, fn] of Object.entries(mutations)) registry[`chat/conversation_context_mutations:${name}`] = fn;
  for (const [name, fn] of Object.entries(native)) registry[`chat/conversation_context_native:${name}`] = fn;
  for (const [name, fn] of Object.entries(operations)) registry[`execution/operations:${name}`] = fn;
  const route = async (ref: unknown, args: Record<string, unknown>) => {
    const name = getFunctionName(ref as never);
    if (["tools/artifacts:listToolMemoriesForAssembly", "tools/artifacts:listArtifactsForAssembly", "mcp/queries:getInvocationContextsInternal"].includes(name)) return [];
    if (name === "chat/queries:getModelCapabilities") return {contextLength: 8000};
    if (name === "chat/queries:getUserPreferences") return {};
    if (name === "chat/queries:getGenerationJobInternal") return rows.generationJobs.find(job => job._id === args.jobId);
    if (name === "chat/mutations:storeAncillaryCost") return null;
    const fn = registry[name];
    if (!fn) throw new Error(`Unexpected context function ${name}`);
    return await invoke(fn, ctx as unknown as MutationCtx, args);
  };
  const action = {...ctx, runQuery: route, runMutation: route} as unknown as ActionCtx;
  return {ctx, rows, action};
}
