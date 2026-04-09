import assert from "node:assert/strict";
import test from "node:test";

import { dataPythonExec } from "../tools/data_python_exec";
import { dataPythonSandbox } from "../tools/data_python_sandbox";
import { spawnSubagents } from "../tools/spawn_subagents";

test("data python tools reject missing code", async () => {
  const execResult = await dataPythonExec.execute({} as any, {});
  const sandboxResult = await dataPythonSandbox.execute({} as any, {});

  assert.equal(execResult.success, false);
  assert.equal(execResult.error, "Missing code.");
  assert.equal(sandboxResult.success, false);
  assert.equal(sandboxResult.error, "Missing code.");
});

test("data python tools surface runtime context errors through execute wrappers", async () => {
  const execResult = await dataPythonExec.execute(
    { userId: "user_1" } as any,
    { code: "print(1)" },
  );
  const sandboxResult = await dataPythonSandbox.execute(
    { userId: "user_1" } as any,
    { code: "print(1)" },
  );

  assert.equal(execResult.success, false);
  assert.match(String(execResult.error), /require chatId/i);
  assert.equal(sandboxResult.success, false);
  assert.match(String(sandboxResult.error), /require chatId/i);
});

test("spawnSubagents validates tasks and returns deferred payload for valid requests", async () => {
  const invalid = await spawnSubagents.execute({} as any, {
    tasks: [{ title: "only title" }],
  } as any);

  const valid = await spawnSubagents.execute({} as any, {
    tasks: [
      { title: "Research", prompt: "Compare the two API options." },
      { title: "Review", prompt: "Check the migration plan for risks." },
    ],
  });

  assert.equal(invalid.success, false);
  assert.match(String(invalid.error), /Provide between 1 and 3 tasks/);
  assert.equal(valid.success, true);
  assert.deepEqual(valid.deferred, {
    kind: "spawn_subagents",
    data: {
      tasks: [
        { title: "Research", prompt: "Compare the two API options." },
        { title: "Review", prompt: "Check the migration plan for risks." },
      ],
    },
  });
});
