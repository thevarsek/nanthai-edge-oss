import assert from "node:assert/strict";
import test from "node:test";
import { heartbeat } from "../runtime_host/presence";

type ValidatorNode = { type: string; value?: unknown };
type ValidatorField = { fieldType: ValidatorNode; optional: boolean };

function field(node: ValidatorNode, name: string): ValidatorField {
  assert.equal(node.type, "object");
  const value = node.value as Record<string, ValidatorField>;
  assert.ok(value[name], `Registered mutation must accept ${name}`);
  return value[name];
}

test("registered presence mutation accepts optional source evidence capability", () => {
  // Handler-only tests bypass Convex's argument validator. Inspect the registered
  // boundary that the real HTTP handler invokes, not another protocol copy.
  const registered = heartbeat as unknown as { exportArgs: () => string };
  const args = JSON.parse(registered.exportArgs()) as ValidatorNode;
  const adapters = field(args, "adapters").fieldType;
  assert.equal(adapters.type, "array");
  const capability = field(
    field(adapters.value as ValidatorNode, "capabilities").fieldType,
    "nanthaiSourceCitations",
  );
  assert.equal(capability.optional, true);
  assert.equal(capability.fieldType.type, "boolean");
});
