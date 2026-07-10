import assert from "node:assert/strict";
import test from "node:test";
import { AdvisorStreamWriter } from "../advisors/stream_writer";

test("AdvisorStreamWriter throttles small deltas and flushes at the size boundary", async () => {
  const patches: string[] = [];
  const writer = new AdvisorStreamWriter({
    runMutation: async (_ref: unknown, args: { partialAdvice: string }) => {
      patches.push(args.partialAdvice);
      return true;
    },
  } as unknown as ConstructorParameters<typeof AdvisorStreamWriter>[0],
  "run_1" as ConstructorParameters<typeof AdvisorStreamWriter>[1]);

  await writer.append("a");
  await writer.append("b");
  assert.deepEqual(patches, ["a"]);
  await writer.append("x".repeat(255));
  assert.equal(patches.length, 2);
  assert.equal(patches[1], `ab${"x".repeat(255)}`);
  await writer.flush();
  assert.equal(patches.length, 2);
});

test("AdvisorStreamWriter stops when the durable run was cancelled", async () => {
  const writer = new AdvisorStreamWriter({
    runMutation: async () => false,
  } as unknown as ConstructorParameters<typeof AdvisorStreamWriter>[0],
  "run_cancelled" as ConstructorParameters<typeof AdvisorStreamWriter>[1]);
  await assert.rejects(writer.append("first delta"), /cancelled/);
});
