export type RuntimePairingSession = {
  pairingId: string; oneTimeCode: string; expiresAt: number;
  pairingCommand?: string; pairingCode?: string; serverOrigin?: string;
};

export function runtimeSignInRedirect(search: string): string {
  const target = new URLSearchParams(search).get("redirect_url");
  if (!target || !["/runtime/connect?", "/mcp/authorize?"].some(path => target.startsWith(path))) return "/app";
  const url = new URL(target, "https://nanthai.tech");
  return ["/runtime/connect", "/mcp/authorize"].includes(url.pathname) ? url.pathname + url.search : "/app";
}

export function runtimePairingLink(session: RuntimePairingSession, state: string): string {
  if (!session.serverOrigin || !/^[a-zA-Z0-9-]{16,100}$/.test(state)) throw new Error("Invalid pairing handoff");
  const server = new URL(session.serverOrigin);
  if (!["http:", "https:"].includes(server.protocol) || server.username || server.password
    || server.search || server.hash || server.pathname !== "/") throw new Error("Invalid pairing server");
  const url = new URL("nanthai-runtime://pair");
  url.searchParams.set("state", state);
  url.searchParams.set("server", server.origin);
  url.searchParams.set("pairingId", session.pairingId);
  url.searchParams.set("code", session.oneTimeCode);
  return url.toString();
}
