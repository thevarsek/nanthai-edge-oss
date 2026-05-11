import assert from "node:assert/strict";
import test from "node:test";

import { dataPythonExec } from "../tools/data_python_exec";
import { dataPythonSandbox } from "../tools/data_python_sandbox";
import { generatePdf } from "../tools/generate_pdf";
import { readPdf } from "../tools/read_pdf";
import { spawnSubagents } from "../tools/spawn_subagents";
import { vmExec } from "../tools/vm_exec";
import { vmDeleteFile } from "../tools/vm_delete_file";
import { vmExportFile } from "../tools/vm_export_file";
import { vmImportFile } from "../tools/vm_import_file";
import { vmListFiles } from "../tools/vm_list_files";
import { vmMakeDirs } from "../tools/vm_make_dirs";
import { vmReadFile } from "../tools/vm_read_file";
import { vmReset } from "../tools/vm_reset";
import { parseVmEnvironment } from "../tools/vm_shared";
import { vmWriteFile } from "../tools/vm_write_file";

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
  const vmReadResult = await vmReadFile.execute({} as any, {});
  const vmWriteResult = await vmWriteFile.execute({} as any, { content: "hello" });
  const vmDeleteResult = await vmDeleteFile.execute({} as any, {});
  const vmMakeDirsResult = await vmMakeDirs.execute({} as any, {});
  const vmImportResult = await vmImportFile.execute({} as any, {});
  const vmExportResult = await vmExportFile.execute({} as any, {});
  const vmResetResult = await vmReset.execute({} as any, { confirm: false });
  const generateResult = await generatePdf.execute({} as any, {
    title: "Quarterly Report",
    sections: [],
  });

  assert.equal(vmResult.success, false);
  assert.equal(vmResult.error, "Missing command.");
  assert.equal(readResult.success, false);
  assert.equal(readResult.error, "Missing storageId.");
  assert.equal(vmReadResult.error, "Missing path.");
  assert.equal(vmWriteResult.error, "Missing path.");
  assert.equal(vmDeleteResult.error, "Missing path.");
  assert.equal(vmMakeDirsResult.error, "Missing path.");
  assert.equal(vmImportResult.error, "Missing storageId.");
  assert.equal(vmExportResult.error, "Missing path.");
  assert.equal(vmResetResult.error, "Set confirm=true to reset the persistent runtime workspace.");
  assert.equal(generateResult.success, false);
  assert.equal(generateResult.error, "Provide at least one section.");
});

test("persistent VM wrappers surface context errors and normalize environment selection", async () => {
  const toolCtx = { userId: "user_1" } as any;
  const results = await Promise.all([
    vmReadFile.execute(toolCtx, { environment: "node", path: "/tmp/readme.txt" }),
    vmWriteFile.execute(toolCtx, { path: "/tmp/readme.txt", content: "hello", overwrite: true }),
    vmListFiles.execute(toolCtx, { environment: "unexpected", recursive: true }),
    vmDeleteFile.execute(toolCtx, { path: "/tmp/readme.txt" }),
    vmMakeDirs.execute(toolCtx, { path: "/tmp/reports" }),
    vmImportFile.execute(toolCtx, { storageId: "storage_1", filename: "source.txt" }),
    vmExportFile.execute(toolCtx, { path: "/tmp/report.txt", filename: "report.txt" }),
    vmReset.execute(toolCtx, { environment: "node", confirm: true }),
  ]);

  for (const result of results) {
    assert.equal(result.success, false);
    assert.match(String(result.error), /require chatId/i);
  }
  assert.equal(parseVmEnvironment("node"), "node");
  assert.equal(parseVmEnvironment("python"), "python");
  assert.equal(parseVmEnvironment("ruby"), "python");
  assert.equal(parseVmEnvironment(undefined), "python");
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
