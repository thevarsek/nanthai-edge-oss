import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import { exchangeSlackCode } from "../oauth/slack";
import {
  assertSlackIntegrationAvailable,
  isSlackIntegrationAvailable,
} from "../lib/integration_availability";
import { registerProfileTools } from "../tools/progressive_registry_profiles";
import { ToolRegistry } from "../tools/registry";
import { executeSlackTool } from "../tools/slack/actions";

function withSlackAvailability<T>(value: string | undefined, run: () => Promise<T> | T): Promise<T> {
  const original = process.env.SLACK_INTEGRATION_AVAILABLE;
  if (value === undefined) delete process.env.SLACK_INTEGRATION_AVAILABLE;
  else process.env.SLACK_INTEGRATION_AVAILABLE = value;
  return Promise.resolve().then(run).finally(() => {
    if (original === undefined) delete process.env.SLACK_INTEGRATION_AVAILABLE;
    else process.env.SLACK_INTEGRATION_AVAILABLE = original;
  });
}

test("Slack is unavailable unless the deployment opts in explicitly", () => {
  assert.equal(isSlackIntegrationAvailable({}), false);
  assert.equal(isSlackIntegrationAvailable({ SLACK_INTEGRATION_AVAILABLE: "false" }), false);
  assert.equal(isSlackIntegrationAvailable({ SLACK_INTEGRATION_AVAILABLE: "1" }), false);
  assert.equal(isSlackIntegrationAvailable({ SLACK_INTEGRATION_AVAILABLE: " true " }), true);
  assert.throws(
    () => assertSlackIntegrationAvailable({}),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "INTEGRATION_UNAVAILABLE",
  );
});

test("an unavailable Slack refuses the code exchange before calling Slack", async () => {
  const originalFetch = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = (async () => {
    fetched = true;
    return new Response("{}");
  }) as typeof fetch;
  try {
    await withSlackAvailability(undefined, () => assert.rejects(
      (exchangeSlackCode as any)._handler(
        { auth: { getUserIdentity: async () => ({ subject: "user_1" }) } },
        { code: "code", redirectUri: "https://example.com/callback" },
      ),
      (error: unknown) => error instanceof ConvexError && error.data?.code === "INTEGRATION_UNAVAILABLE",
    ));
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetched, false);
});

test("an unavailable Slack registers no tools and refuses tool execution", async () => {
  const options = { enabledIntegrations: ["slack"] } as any;
  await withSlackAvailability(undefined, async () => {
    const registry = new ToolRegistry();
    registerProfileTools(registry, "slack", options);
    assert.equal(registry.size, 0);
    const result = await (executeSlackTool as any)._handler({}, {
      toolName: "slack_send_message",
      toolArgs: { channel_id: "C1", message: "hi" },
      toolContext: { userId: "user_1" },
    });
    assert.equal(result.success, false);
    assert.match(String(result.error), /not available/);
  });
  await withSlackAvailability("true", () => {
    const registry = new ToolRegistry();
    registerProfileTools(registry, "slack", options);
    assert.ok(registry.get("slack_send_message"));
  });
});
