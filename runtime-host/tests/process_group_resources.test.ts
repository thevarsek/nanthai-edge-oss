import assert from "node:assert/strict";
import test from "node:test";

import {
  parseLsofDescriptorCount,
  parsePosixProcessTable,
  processGroupResourceSupport,
} from "../src/process_group_resources.ts";

test("aggregates worker and descendants in one POSIX process group", () => {
  const sample = parsePosixProcessTable([
    " 100  100  1024  00:01.50",
    " 101  100  2048  01:02.25",
    " 200  200  4096  00:10.00",
  ].join("\n"), 100);

  assert.deepEqual(sample, {
    pid: 100,
    rssBytes: 3_072 * 1_024,
    cpuMillis: 63_750,
    descriptorCount: null,
  });
});

test("counts POSIX process-group descriptors from lsof field output", () => {
  assert.equal(parseLsofDescriptorCount("p100\nf0\nf1\np101\nf2\n"), 3);
});

test("keeps Windows process-tree telemetry explicitly unsupported", () => {
  assert.deepEqual(processGroupResourceSupport("win32"), {
    supported: false,
    mode: "windows_job_object_telemetry_required",
  });
});
