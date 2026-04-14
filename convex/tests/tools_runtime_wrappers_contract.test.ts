import assert from "node:assert/strict";
import test from "node:test";

import { dataPythonExec } from "../tools/data_python_exec";
import { dataPythonSandbox } from "../tools/data_python_sandbox";
import { generatePdf } from "../tools/generate_pdf";
import { readPdf } from "../tools/read_pdf";
import { spawnSubagents } from "../tools/spawn_subagents";
import { vmExec } from "../tools/vm_exec";

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

test("persistent runtime wrappers validate required args", async () => {
  const vmResult = await vmExec.execute({} as any, {});
  const readResult = await readPdf.execute({} as any, {});
  const generateResult = await generatePdf.execute({} as any, {
    title: "Quarterly Report",
    sections: [],
  });

  assert.equal(vmResult.success, false);
  assert.equal(vmResult.error, "Missing command.");
  assert.equal(readResult.success, false);
  assert.equal(readResult.error, "Missing storageId.");
  assert.equal(generateResult.success, false);
  assert.equal(generateResult.error, "Provide at least one section.");
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
