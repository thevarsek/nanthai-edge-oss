import { resolveCodexCommand, verifyCodexVersion } from "./codex_executable.ts";

import { z } from "zod";

import { JsonRpcStdioClient } from "./json_rpc_stdio_client.ts";
import {
  CODEX_APP_SERVER_PROTOCOL,
} from "./runtime_identity.ts";
import { parseModels } from "./transports/app_server_protocol_mapping.ts";

const PlanTypeSchema = z.enum([
  "free", "go", "plus", "pro", "prolite", "team",
  "self_serve_business_prolite", "self_serve_business_usage_based", "business",
  "ent26", "enterprise_cbp_automation", "enterprise_cbp_usage_based",
  "enterprise", "edu", "unknown",
]);
const AccountSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("apiKey") }),
  z.object({
    type: z.literal("chatgpt"),
    email: z.string().email().nullable(),
    planType: PlanTypeSchema,
  }),
  z.object({
    type: z.literal("amazonBedrock"),
    usesCodexManagedCredentials: z.boolean(),
  }),
]);
const GetAccountResponseSchema = z.object({
  account: AccountSchema.nullable(),
  requiresOpenaiAuth: z.boolean(),
});
const RateLimitWindowSchema = z.object({
  usedPercent: z.number().finite(),
  windowDurationMins: z.number().finite().nullable(),
  resetsAt: z.number().finite().nullable(),
});
const RateLimitSnapshotSchema = z.object({
  limitId: z.string().nullable(),
  limitName: z.string().nullable(),
  primary: RateLimitWindowSchema.nullable(),
  secondary: RateLimitWindowSchema.nullable(),
  planType: PlanTypeSchema.nullable(),
});
const RateLimitsResponseSchema = z.object({
  rateLimits: RateLimitSnapshotSchema,
  rateLimitsByLimitId: z.record(z.string(), RateLimitSnapshotSchema).nullable(),
});

export type CodexAccountSummary = {
  authMethod: "chatgpt" | "api_key" | "amazon_bedrock" | "signed_out";
  identity: string | null;
  plan: string | null;
  requiresOpenaiAuth: boolean;
};

export type CodexProbeSummary = {
  healthy: boolean;
  adapter: "codex_app_server";
  transport: "stdio";
  cliVersion: string;
  protocolVersion: string;
  command: string;
  account: CodexAccountSummary;
  modelCount: number;
  rateLimits: z.infer<typeof RateLimitSnapshotSchema> | null;
  rateLimitReadError: string | null;
};

export type CodexOperatorOptions = {
  command?: string;
  args?: string[];
  cwd?: string;
};

export class CodexAppServerOperator {
  constructor(private readonly options: CodexOperatorOptions = {}) {}

  async inspect(): Promise<CodexProbeSummary> {
    const command = this.options.command ?? await resolveCodexCommand();
    const cliVersion = await verifyCodexVersion(command, this.options.args);
    const client = JsonRpcStdioClient.spawn({
      command,
      args: [...(this.options.args ?? []), "app-server", "--listen", "stdio://"],
      ...(this.options.cwd === undefined ? {} : { cwd: this.options.cwd }),
    }, { dialect: "codex_app_server" });
    try {
      await client.request("initialize", {
        clientInfo: { name: "nanthai-runtime-host", version: "0.1.0" },
      });
      client.notify("initialized");
      const accountResponse = GetAccountResponseSchema.parse(
        await client.request("account/read", { refreshToken: false }),
      );
      const models = parseModels(await client.request("model/list", {}));
      const rateLimitResult = await readRateLimits(client);
      return {
        healthy: true,
        adapter: "codex_app_server",
        transport: "stdio",
        cliVersion,
        protocolVersion: CODEX_APP_SERVER_PROTOCOL,
        command,
        account: accountSummary(accountResponse),
        modelCount: models.filter((model) => !model.hidden).length,
        rateLimits: rateLimitResult.value,
        rateLimitReadError: rateLimitResult.error,
      };
    } finally {
      await client.close();
    }
  }
}

async function readRateLimits(client: JsonRpcStdioClient): Promise<{
  value: z.infer<typeof RateLimitSnapshotSchema> | null;
  error: string | null;
}> {
  try {
    const response = RateLimitsResponseSchema.parse(
      await client.request("account/rateLimits/read"),
    );
    return { value: response.rateLimits, error: null };
  } catch (error) {
    return { value: null, error: publicError(error) };
  }
}

function accountSummary(
  response: z.infer<typeof GetAccountResponseSchema>,
): CodexAccountSummary {
  const account = response.account;
  if (account === null) {
    return {
      authMethod: "signed_out",
      identity: null,
      plan: null,
      requiresOpenaiAuth: response.requiresOpenaiAuth,
    };
  }
  if (account.type === "chatgpt") {
    return {
      authMethod: "chatgpt",
      identity: account.email,
      plan: account.planType,
      requiresOpenaiAuth: response.requiresOpenaiAuth,
    };
  }
  return {
    authMethod: account.type === "apiKey" ? "api_key" : "amazon_bedrock",
    identity: null,
    plan: null,
    requiresOpenaiAuth: response.requiresOpenaiAuth,
  };
}

function publicError(error: unknown): string {
  return error instanceof Error ? error.message : "Rate-limit status is unavailable";
}
