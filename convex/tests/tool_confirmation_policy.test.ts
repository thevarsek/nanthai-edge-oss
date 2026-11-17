import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmationCandidate,
  isConfirmationGatedTool,
  scheduledJobCapabilities,
  splitAddresses,
  unnamedRecipients,
} from "../tools/confirmation_policy";
import { createTool } from "../tools/registry";
import { TOOL_EFFECT_POLICIES } from "../tools/effect_policy_inventory";

test("every send/post tool is gated and drafts and reads are not", () => {
  for (const name of ["gmail_send", "outlook_send", "slack_send_message", "slack_schedule_message", "ms_calendar_create"]) {
    assert.equal(isConfirmationGatedTool(name), true, name);
    assert.ok(TOOL_EFFECT_POLICIES[name], `${name} is a registered production tool`);
  }
  for (const name of ["gmail_create_draft", "outlook_create_draft", "slack_send_message_draft", "gmail_read", "notion_create_page"]) {
    assert.equal(confirmationCandidate(name, {}), null, name);
  }
});

test("email recipients are normalized across to, cc and bcc", () => {
  const candidate = confirmationCandidate("gmail_send", {
    to: "Alice <Alice@Example.com>", cc: "bob@example.com; carol@example.com", bcc: "dave@example.com",
    subject: "Q3", body: "Numbers attached",
  });
  assert.deepEqual(candidate?.recipients, ["alice@example.com", "bob@example.com", "carol@example.com", "dave@example.com"]);
  assert.equal(candidate?.summary, "Q3");
  assert.equal(candidate?.detail, "Numbers attached");
  assert.deepEqual(splitAddresses(" , x@y.z"), ["x@y.z"]);
});

test("recipients must be named in user-authored text", () => {
  assert.deepEqual(unnamedRecipients(["alice@example.com", "c0123"], ["Mail ALICE@example.com", "post in #general"]), ["c0123"]);
  assert.deepEqual(unnamedRecipients([""], ["anything"]), [""]);
});

test("scheduled jobs need confirmation only when they enable an integration or web search", () => {
  assert.equal(confirmationCandidate("create_scheduled_job", { name: "Plain", prompt: "Summarize" }), null);
  assert.deepEqual(scheduledJobCapabilities({ enabledIntegrations: ["gmail"], webSearchEnabled: true }), ["gmail", "web_search"]);
  assert.deepEqual(scheduledJobCapabilities({
    steps: [
      { prompt: "a", searchMode: "research" },
      { prompt: "b", turnIntegrationOverrides: [{ integrationId: "slack", enabled: true }, { integrationId: "drive", enabled: false }] },
    ],
  }), ["web_search", "slack"]);
  const update = confirmationCandidate("update_scheduled_job", { jobName: "Digest", webSearchEnabled: true });
  assert.equal(update?.kind, "scheduled_job");
  assert.equal(update?.summary, "Digest");
});

test("model skill creation and edits always need confirmation", () => {
  const created = confirmationCandidate("create_skill", {
    name: "Mailer", summary: "Sends mail", requiredIntegrationIds: ["gmail"], requiredToolProfiles: ["docs"],
  });
  assert.equal(created?.kind, "skill_change");
  assert.deepEqual(created?.integrations, ["gmail", "docs"]);
  assert.equal(confirmationCandidate("update_skill", { skillName: "Mailer" })?.summary, "Mailer");
});

test("gated tools serialize within a round like other deferrable tools", () => {
  const tool = createTool({
    name: "gmail_send",
    description: "send",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ success: true, data: null }),
  });
  assert.equal(tool.mayDefer, true);
});

test("display fields are bounded", () => {
  const candidate = confirmationCandidate("slack_send_message", { channel_id: "C1", message: "x".repeat(1_000) });
  assert.equal(candidate?.summary.length, 200);
  assert.deepEqual(candidate?.recipients, ["c1"]);
});
