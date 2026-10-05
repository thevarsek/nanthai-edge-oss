import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { z } from "zod";
import { MonthlyUsageSchema, mergeMonthlyUsage } from "../../shared/runtime_usage.mts";
import type { CredentialStore } from "./credential_store.ts";
import type { MonthlyUsage, UsageReader } from "./usage_history.ts";
import { HttpJsonClient, RuntimeHttpError, type FetchImplementation } from "./http_json_client.ts";

const pageSchema = z.object({ userId: z.string().min(1), deviceId: z.string().min(1),
  throughMs: z.number().int().nonnegative(), months: z.array(z.unknown().transform(value => MonthlyUsageSchema.parse(value))),
  isDone: z.boolean(), continueCursor: z.string() });
const cacheSchema = pageSchema.omit({ isDone: true, continueCursor: true }).extend({ version: z.literal(1) });

/** Canonical account/Mac totals; native observations remain a separate diagnostic. */
export class CanonicalUsageHistory implements UsageReader {
  constructor(private readonly credentials: CredentialStore, private readonly directory: string,
    private readonly fetchImplementation?: FetchImplementation) {}

  async list(month?: string): Promise<readonly MonthlyUsage[]> {
    const credential = await this.credentials.readDeviceCredential();
    if (!credential) return [];
    const key = createHash("sha256").update(JSON.stringify([credential.controlPlaneUrl, credential.deviceId])).digest("hex");
    const path = join(this.directory, `${key}.json`);
    const client = new HttpJsonClient(credential.controlPlaneUrl,
      this.fetchImplementation ? { fetch: this.fetchImplementation } : {});
    const headers = { Authorization: `Bearer ${credential.credential}`,
      "X-NanthAI-Device-ID": credential.deviceId, "X-NanthAI-Credential-ID": credential.credentialId };
    let months: MonthlyUsage[];
    try {
      let cursor: string | null = null;
      let throughMs: number | undefined;
      let userId: string | undefined;
      const pages: MonthlyUsage[] = [];
      let complete = false;
      while (!complete) {
        const page: z.infer<typeof pageSchema> = await client.post("/runtime-host/v1/usage/history", {
          cursor, ...(throughMs === undefined ? {} : { throughMs }),
        }, pageSchema, headers);
        if (page.deviceId !== credential.deviceId || userId !== undefined && page.userId !== userId
          || throughMs !== undefined && page.throughMs !== throughMs) {
          throw new Error("Canonical usage response belongs to another account or snapshot");
        }
        userId = page.userId;
        throughMs = page.throughMs;
        pages.push(...page.months);
        complete = page.isDone;
        if (complete) break;
        if (page.continueCursor === cursor || !page.continueCursor) throw new Error("Canonical usage pagination did not advance");
        cursor = page.continueCursor;
      }
      months = mergeMonthlyUsage(pages);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify({ version: 1, userId, deviceId: credential.deviceId, throughMs, months }), { mode: 0o600 });
      await rename(temporary, path);
    } catch (error) {
      if (!(error instanceof RuntimeHttpError) || ![0, 503, 504].includes(error.status)) throw error;
      let cached;
      try { cached = cacheSchema.parse(JSON.parse(await readFile(path, "utf8")) as unknown); }
      catch (cacheError) {
        if (cacheError instanceof Error && "code" in cacheError && cacheError.code === "ENOENT") throw error;
        throw cacheError;
      }
      if (cached.deviceId !== credential.deviceId) throw new Error("Canonical usage cache belongs to another Mac");
      months = cached.months;
    }
    return month === undefined ? months : months.filter(value => value.month === month);
  }
}
