/** One Workflow driver for discussion and work policies. Policies own one safe
 * transition at a time; all provider effects retain their fail-closed options. */
export async function runConversationWorkflow(advance: () => Promise<"continue" | "terminal">): Promise<null> {
  while (await advance() === "continue") { /* Progress is persisted by the policy. */ }
  return null;
}
