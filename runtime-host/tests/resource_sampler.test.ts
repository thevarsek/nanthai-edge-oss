import assert from "node:assert/strict";
import test from "node:test";

import { ResourceSampler } from "../src/resource_sampler.ts";

test("retains bounded samples and reports peaks", () => {
  let value = 1;
  const sampler = new ResourceSampler(
    2,
    () => value,
    () => ({
      rss: value * 10,
      heapTotal: value * 4,
      heapUsed: value * 3,
      external: value * 2,
      arrayBuffers: value,
    }),
    () => ({
      userCPUTime: value,
      systemCPUTime: value,
      maxRSS: value,
      sharedMemorySize: 0,
      unsharedDataSize: 0,
      unsharedStackSize: 0,
      minorPageFault: 0,
      majorPageFault: 0,
      swappedOut: 0,
      fsRead: 0,
      fsWrite: 0,
      ipcSent: 0,
      ipcReceived: 0,
      signalsCount: 0,
      voluntaryContextSwitches: 0,
      involuntaryContextSwitches: 0,
    }),
  );
  sampler.sample(
    { items: 1, bytes: 10, evictedItems: 0, evictedBytes: 0 },
    { pid: 10, rssBytes: 100, cpuMillis: 1, descriptorCount: 2 },
  );
  value = 2;
  sampler.sample(
    { items: 1, bytes: 20, evictedItems: 0, evictedBytes: 0 },
    { pid: 10, rssBytes: 200, cpuMillis: 2, descriptorCount: 4 },
  );
  value = 3;
  sampler.sample(
    { items: 1, bytes: 15, evictedItems: 0, evictedBytes: 0 },
    { pid: 10, rssBytes: 300, cpuMillis: 3, descriptorCount: 6 },
  );

  const summary = sampler.summary();
  assert.equal(summary.sampleCount, 2);
  assert.equal(summary.first?.sampledAtMs, 2);
  assert.equal(summary.peakRssBytes, 30);
  assert.equal(summary.peakBufferedBytes, 20);
  assert.equal(summary.peakChildRssBytes, 300);
  assert.equal(summary.peakChildDescriptorCount, 6);
});
