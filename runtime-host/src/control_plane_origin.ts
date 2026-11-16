/** Validate before transmitting credentials, including previously saved pairings. */
export function controlPlaneOrigin(value: string, originOnly = true): string {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    || url.username || url.password || url.search || url.hash || (originOnly && !["", "/"].includes(url.pathname))) {
    throw new Error("The control plane must be an HTTPS origin (HTTP is supported only on loopback for development).");
  }
  return url.origin;
}
