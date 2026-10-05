export async function dynamicToolResponse(
  params: unknown,
  handler: ((request: unknown) => Promise<unknown>) | undefined,
): Promise<unknown> {
  try {
    if (!handler) throw new Error("NanthAI capability bridge is unavailable");
    const request = params as { callId?: unknown; tool?: unknown; arguments?: unknown };
    const result = await handler({ callId: request.callId, tool: request.tool, arguments: request.arguments });
    return { success: true, contentItems: [{ type: "inputText", text: typeof result === "string" ? result : JSON.stringify(result) ?? "" }] };
  } catch (error) {
    return { success: false, contentItems: [{ type: "inputText", text: error instanceof Error ? error.message.slice(0, 2_000) : "NanthAI tool failed" }] };
  }
}
