import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BridgeRequestSchema, BRIDGE_TOOLS, type LocalRuntimeTurnPacket } from "./protocol.ts";
import { PI_BRIDGE_EXTENSION } from "./pi_bridge_extension.ts";
import type { translatePiPacket } from "./pi_packet_translation.ts";

export class PiBridgeServer {
  private constructor(readonly directory: string, private readonly server: Server) {}

  static async start(packet: LocalRuntimeTurnPacket, translated: Awaited<ReturnType<typeof translatePiPacket>>,
    handler: (request: unknown) => Promise<unknown>): Promise<PiBridgeServer> {
    const token = randomBytes(32).toString("hex");
    const server = createServer((request, response) => {
      void (async () => {
        if (request.method !== "POST" || request.url !== "/bridge" || request.headers.authorization !== `Bearer ${token}`) {
          response.writeHead(401).end(); return;
        }
        let body = "";
        for await (const chunk of request) {
          body += String(chunk);
          if (Buffer.byteLength(body) > 1024 * 1024) throw new Error("Pi bridge request exceeded capacity");
        }
        const value = BridgeRequestSchema.parse(JSON.parse(body));
        if (!packet.capabilities.nanthaiTools.some(tool => tool.id === value.tool)) throw new Error("Tool is not bound for this turn");
        const result = await handler(value);
        response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
      })().catch(() => { if (!response.headersSent) response.writeHead(400); response.end(); });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const directory = await mkdtemp(join(tmpdir(), "nanthai-pi-bridge-"));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Pi bridge listener unavailable");
      await writeFile(join(directory, "extension.mjs"), PI_BRIDGE_EXTENSION, { mode: 0o600 });
      await writeFile(join(directory, "config.json"), JSON.stringify({
        token, url: `http://127.0.0.1:${address.port}/bridge`,
        history: translated.history, instructions: translated.instructions,
        tools: BRIDGE_TOOLS.filter(tool => packet.capabilities.nanthaiTools.some(bound => bound.id === tool.name)),
      }), { mode: 0o600 });
      return new PiBridgeServer(directory, server);
    } catch (error) {
      server.close(); await rm(directory, { recursive: true, force: true }); throw error;
    }
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve, reject) => this.server.close(error => error ? reject(error) : resolve()));
    await rm(this.directory, { recursive: true, force: true });
  }
}
