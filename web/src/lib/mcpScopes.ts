// Consent-page scope selection for external MCP clients. Higher-risk scopes
// start unticked; running on the paired computer also requires tool access.
// The backend enforces the same dependency when the grant is created.

export const MCP_OPT_IN_SCOPES: readonly string[] = ["chat:tools", "runtime:local"];
export const MCP_SCOPE_DEPENDENCIES: Readonly<Record<string, string>> = { "runtime:local": "chat:tools" };

/** `toggled` lists scopes the user changed from their default state. */
export function selectedMcpScopes(offered: readonly string[], toggled: readonly string[]): string[] {
  const chosen = offered.filter(scope => MCP_OPT_IN_SCOPES.includes(scope) === toggled.includes(scope));
  return chosen.filter(scope => {
    const dependency = MCP_SCOPE_DEPENDENCIES[scope];
    return !dependency || chosen.includes(dependency);
  });
}
