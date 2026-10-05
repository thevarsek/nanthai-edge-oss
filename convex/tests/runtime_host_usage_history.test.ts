import assert from "node:assert/strict";
import test from "node:test";
import type { QueryCtx } from "../_generated/server";
import { listForHostHandler } from "../runtime_host/usage_history";
import { mergeMonthlyUsage } from "../../shared/runtime_usage.mts";
import { fixture, oldHost } from "./runtime_host_event_replay_fixture";
import { usageHistoryHttp } from "../runtime_host/http_usage";

test("canonical history pages all months for only the credential's account and Mac", async () => {
  const { ctx, rows } = await fixture();
  attachUsageQuery(ctx as unknown as QueryCtx, rows);
  const throughMs = Date.UTC(2026, 10, 1);
  const row = (id: number, userId = "user-1", deviceId: string | undefined = "device-1") => ({
    _id: `usage-${id}`, userId, runtimeDeviceId: deviceId, messageId: "message-1", chatId: "chat-1",
    modelId: "gpt-6.1-sol", provider: "openai", promptTokens: 10, completionTokens: 2,
    totalTokens: 12, costAttribution: "unpriced", createdAt: Date.UTC(id === 100 ? 2024 : 2026, 0, 1) + id,
  });
  rows.usageRecords = [...Array.from({ length: 101 }, (_, index) => row(index)),
    row(102, "foreign-user"), row(103, "user-1", "other-device"),
    { ...row(104), runtimeDeviceId: undefined }, { ...row(105), createdAt: throughMs + 1 }];
  const first = await listForHostHandler(ctx as unknown as QueryCtx, { ...oldHost, cursor: null, throughMs });
  assert.equal(first.isDone, false);
  const second = await listForHostHandler(ctx as unknown as QueryCtx, { ...oldHost, cursor: first.continueCursor, throughMs });
  assert.equal(second.isDone, true);
  const totals = mergeMonthlyUsage([...first.months, ...second.months]);
  assert.deepEqual(totals.map(month => month.month), ["2026-01", "2024-01"]);
  assert.equal(totals.reduce((sum, month) => sum + month.turnReports, 0), 101);
  assert.equal(totals.reduce((sum, month) => sum + month.tokens.total.known, 0), 1212);
  assert.equal(totals[0].unpricedReports, 100);
  assert.deepEqual(totals[0].costs, []);
  assert.equal(totals[0].tokens.cachedInput.unavailableReports, 100);
  rows.runtimeDeviceCredentials[0].status = "revoked";
  await assert.rejects(listForHostHandler(ctx as unknown as QueryCtx, { ...oldHost, cursor: null }), /invalid or revoked/);
});

test("canonical generation retains actual price currency, version and unknown token components", async () => {
  const { ctx, rows } = await fixture();
  attachUsageQuery(ctx as unknown as QueryCtx, rows);
  rows.generationJobs[0].runtimeUsage = { costSource: "api_equivalent_estimate", costCurrency: "EUR", pricingVersion: "v2", inputTokens: 10, totalTokens: 12 };
  rows.usageRecords = [{ userId: "user-1", runtimeDeviceId: "device-1", messageId: "message-1", chatId: "chat-1", source: "runtime_generation", modelId: "actual-model", provider: "openai", promptTokens: 10, completionTokens: 2, totalTokens: 12, cost: 0.2, costAttribution: "api_equivalent_estimate", createdAt: Date.UTC(2026, 0, 1) }];
  const result = await listForHostHandler(ctx as unknown as QueryCtx, { ...oldHost, cursor: null });
  assert.equal(result.months[0].modelId, "actual-model");
  assert.deepEqual(result.months[0].costs, [{ source: "api_equivalent_estimate", currency: "EUR", pricingVersion: "v2", amount: 0.2 }]);
  assert.deepEqual(result.months[0].tokens.output, { known: 0, unavailableReports: 1 });
});

test("usage HTTP requires the device credential but no online presence", async () => {
  const { ctx, rows } = await fixture();
  attachUsageQuery(ctx as unknown as QueryCtx, rows);
  const request = new Request("https://dev.test/runtime-host/v1/usage/history", { method: "POST",
    headers: { Authorization: `Bearer ${oldHost.credential}`, "X-NanthAI-Device-ID": oldHost.deviceId,
      "X-NanthAI-Credential-ID": oldHost.credentialId }, body: JSON.stringify({ cursor: null }) });
  const actionCtx = { runQuery: async (_reference: unknown, args: Parameters<typeof listForHostHandler>[1]) => listForHostHandler(ctx as unknown as QueryCtx, args) };
  const response = await usageHistoryHttp(actionCtx as unknown as Parameters<typeof usageHistoryHttp>[0], request);
  assert.equal(response.status, 200);
  const denied = await usageHistoryHttp(actionCtx as unknown as Parameters<typeof usageHistoryHttp>[0], new Request(request.url, { method: "POST", body: '{"cursor":null}' }));
  assert.equal(denied.status, 401);
});

function attachUsageQuery(ctx: QueryCtx, rows: Record<string, Array<Record<string, unknown>>>) {
  const original = ctx.db.query.bind(ctx.db);
  ctx.db.query = ((table: string) => {
    if (table !== "usageRecords") return original(table as "generationJobs");
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    const builder = {
      eq: (field: string, value: unknown) => { filters.push(row => row[field] === value); return builder; },
      lte: (field: string, value: number) => { filters.push(row => typeof row[field] === "number" && row[field] <= value); return builder; },
    };
    const query = {
      withIndex: (index: string, callback: (value: typeof builder) => unknown) => {
        assert.equal(index, "by_user_runtime_device"); callback(builder); return query;
      },
      order: (direction: string) => { assert.equal(direction, "desc"); return query; },
      paginate: async ({ cursor, numItems }: { cursor: string | null; numItems: number }) => {
        const matching = rows.usageRecords.filter(row => filters.every(filter => filter(row)))
          .sort((left, right) => Number(right.createdAt) - Number(left.createdAt));
        const offset = Number(cursor ?? 0);
        const page = matching.slice(offset, offset + numItems);
        return { page, isDone: offset + page.length >= matching.length, continueCursor: String(offset + page.length) };
      },
    };
    return query;
  }) as unknown as typeof ctx.db.query;
}
