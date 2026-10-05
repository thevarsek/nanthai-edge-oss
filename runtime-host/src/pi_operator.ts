import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { resolveRuntimeExecutable } from "./codex_executable.ts";
import { PiRpcClient } from "./pi_rpc_client.ts";
import { piModels, PiModelSchema } from "./pi_models.ts";

export type PiProbeSummary = {
  healthy: boolean; adapter: "pi_rpc"; transport: "stdio"; cliVersion: string;
  protocolVersion: "rpc"; command: string; modelCount: number;
  account: { authMethod: "configured" | "signed_out"; identity: null; plan: null; requiresOpenaiAuth: false };
  rateLimits: null; rateLimitReadError: null;
};

export async function verifyPiVersion(command: string, args: readonly string[] = []): Promise<string> {
  const { stdout } = await promisify(execFile)(command, [...args, "--version"], { timeout: 10_000, maxBuffer: 16_384 });
  const version = /^(\d+)\.(\d+)\.(\d+)\s*$/.exec(stdout.trim());
  if (!version || Number(version[1]) < 1) throw new Error("Select Pi 1.0.0 or newer with its maintained RPC interface");
  return stdout.trim();
}

export class PiOperator {
  async inspect(): Promise<PiProbeSummary> {
    const command = await resolveRuntimeExecutable(process.env.NANTHAI_PI_COMMAND?.trim(), "Pi", "NANTHAI_PI_COMMAND");
    const cliVersion = await verifyPiVersion(command);
    const directory = process.env.NANTHAI_PI_WORKING_DIRECTORY?.trim();
    const client = PiRpcClient.spawn({ command, args: ["--mode", "rpc", "--no-session"], ...(directory ? { cwd: directory } : {}) });
    try {
      const models = await piModels(client);
      const state = z.object({ model: PiModelSchema.optional() }).parse(await client.request("get_state"));
      const ready = models.some(model => model.availability === "available" && model.provider === state.model?.provider && model.modelId === state.model.id);
      return {
        healthy: ready, adapter: "pi_rpc", transport: "stdio", cliVersion, protocolVersion: "rpc", command,
        modelCount: models.filter(model => model.availability === "available").length,
        account: { authMethod: ready ? "configured" : "signed_out", identity: null, plan: null, requiresOpenaiAuth: false },
        rateLimits: null, rateLimitReadError: null,
      };
    } finally { await client.close(); }
  }
}
