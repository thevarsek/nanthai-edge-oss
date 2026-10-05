import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  type AdapterEvent,
  AdapterEventSchema,
} from "../runtime_host/protocol_adapter";
import {
  M46RunEventProjectionSchema,
  projectConsequentialAdapterEvent,
} from "../runtime_host/event_projection";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(
    new URL(`../../fixtures/m45/${name}`, import.meta.url),
    "utf8",
  ));
}

const eventInputs = fixture("adapter-events-v1.json") as unknown[];

test("adapter fixture freezes every normalized event family", () => {
  const events = eventInputs.map((event) => AdapterEventSchema.parse(event));
  assert.deepEqual(events.map((event) => event.type), [
    "session_started",
    "text_delta",
    "reasoning_delta",
    "tool_started",
    "tool_progress",
    "command_output",
    "evidence_observed",
    "permission_requested",
    "permission_resolved",
    "tool_completed",
    "artifact_created",
    "model_observed",
    "usage_reported",
    "heartbeat",
    "input_requested",
    "input_resolved",
    "terminal",
  ]);
});

test("only consequential events project to bounded coarse M46 events", () => {
  const events = eventInputs.map((event) => AdapterEventSchema.parse(event));
  const ignored = new Set([
    "text_delta",
    "reasoning_delta",
    "tool_progress",
    "command_output",
    "heartbeat",
  ]);
  for (const event of events) {
    const projected = projectConsequentialAdapterEvent(event);
    if (ignored.has(event.type)) {
      assert.equal(projected, null, `${event.type} should stay off runEvents`);
    } else {
      assert.ok(projected, `${event.type} should produce a coarse event`);
      M46RunEventProjectionSchema.parse(projected);
    }
  }
});

test("permission projection is Unicode-safe and remains valid at schema bounds", () => {
  const base = eventInputs
    .map((event) => AdapterEventSchema.parse(event))
    .find((event) => event.type === "permission_requested");
  assert.ok(base && base.type === "permission_requested");
  const permission = {
    ...base,
    prompt: `${"a".repeat(1_999)}😀${"b".repeat(1_999)}`,
  };
  const event = AdapterEventSchema.parse(permission);
  const projected = projectConsequentialAdapterEvent(event);
  assert.ok(projected);
  assert.equal(projected.type, "waiting_for_permission");
  assert.ok(projected.summary.length <= 2_000);
  assert.equal(/[\uD800-\uDBFF]$/.test(projected.summary), false);
  assert.ok(projected.adapterDetail);
  assert.ok(projected.adapterDetail.length <= 4_000);
  const detail = JSON.parse(projected.adapterDetail) as { truncated?: boolean };
  assert.equal(detail.truncated, true);
});

test("private local paths and raw command output never enter M46 detail", () => {
  const evidence = eventInputs
    .map((event) => AdapterEventSchema.parse(event))
    .find((event) => event.type === "evidence_observed");
  assert.ok(evidence);
  const projected = projectConsequentialAdapterEvent(evidence);
  assert.ok(projected?.adapterDetail);
  assert.equal(projected.adapterDetail.includes("/Users/"), false);

  const commandOutput = eventInputs
    .map((event) => AdapterEventSchema.parse(event))
    .find((event) => event.type === "command_output");
  assert.ok(commandOutput);
  assert.equal(projectConsequentialAdapterEvent(commandOutput), null);
});

test("usage remains truthful when an adapter does not report actual model", () => {
  const usage = eventInputs
    .map((event) => AdapterEventSchema.parse(event))
    .find((event) => event.type === "usage_reported");
  assert.ok(usage);
  assert.equal(usage.type, "usage_reported");
  if (usage.type !== "usage_reported") return;
  assert.equal(usage.actualModel, null);
  assert.equal(usage.cost.source, "unpriced");
  const projected = projectConsequentialAdapterEvent(usage);
  assert.ok(projected?.adapterDetail?.includes('"actualModel":null'));
  assert.ok(projected?.adapterDetail?.includes('"modelAttribution":"unavailable"'));

  const reported = AdapterEventSchema.parse({
    ...usage,
    eventId: "event-usage-with-model",
    actualModel: {
      provider: "openai",
      modelId: "gpt-5.6-codex-mini",
      reportedByAdapter: true,
    },
    cost: {
      source: "api_equivalent_estimate",
      amount: 0.0123,
      currency: "USD",
      pricingVersion: "pricing-2026-08-15",
    },
  });
  const reportedProjection = projectConsequentialAdapterEvent(reported);
  assert.ok(reportedProjection?.adapterDetail?.includes("adapter_reported"));
});

test("events reject unknown fields, unlabelled cost, and embedded selections", () => {
  const session = AdapterEventSchema.parse(eventInputs[0]);
  const unknown = { ...session, privateTranscript: "must not cross the boundary" };
  assert.equal(AdapterEventSchema.safeParse(unknown).success, false);

  const usage = eventInputs
    .map((event) => AdapterEventSchema.parse(event))
    .find((event) => event.type === "usage_reported");
  assert.ok(usage && usage.type === "usage_reported");
  const invalidCost = { ...usage, cost: { amount: 1, currency: "USD" } };
  assert.equal(AdapterEventSchema.safeParse(invalidCost).success, false);

  const model = eventInputs
    .map((event) => AdapterEventSchema.parse(event))
    .find((event) => event.type === "model_observed");
  assert.ok(model && model.type === "model_observed");
  const selectedModel = { ...model, selectedModel: model.actualModel };
  assert.equal(AdapterEventSchema.safeParse(selectedModel).success, false);

  const modelWithoutIdentity = { ...model, actualModel: null };
  assert.equal(AdapterEventSchema.safeParse(modelWithoutIdentity).success, false);
});

test("terminal outcomes map exactly to existing M46 terminal event types", () => {
  const terminal = eventInputs
    .map((event) => AdapterEventSchema.parse(event))
    .find((event) => event.type === "terminal");
  assert.ok(terminal && terminal.type === "terminal");
  const outcomes: AdapterEvent[] = [
    terminal,
    { ...terminal, eventId: "terminal-failed", outcome: "failed" },
    { ...terminal, eventId: "terminal-cancelled", outcome: "cancelled" },
    { ...terminal, eventId: "terminal-interrupted", outcome: "interrupted" },
  ];
  assert.deepEqual(
    outcomes.map((event) => projectConsequentialAdapterEvent(event)?.type),
    ["completed", "failed", "cancelled", "interrupted"],
  );
});

test("structured input is distinct from permission and projects redacted state", () => {
  const requested = eventInputs
    .map((event) => AdapterEventSchema.parse(event))
    .find((event) => event.type === "input_requested");
  assert.ok(requested && requested.type === "input_requested");
  const projected = projectConsequentialAdapterEvent(requested);
  assert.equal(projected?.type, "waiting_for_input");
  assert.ok(projected?.adapterDetail);
  assert.equal(projected.adapterDetail.includes("eu-west"), false);
  assert.equal(projected.adapterDetail.includes("contentRedacted"), true);
});
