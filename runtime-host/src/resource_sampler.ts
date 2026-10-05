import type { EventBufferSnapshot } from "./bounded_event_buffer.ts";

export type ChildResourceSample = {
  pid: number;
  rssBytes: number | null;
  cpuMillis: number | null;
  descriptorCount: number | null;
};

export type ResourceSample = {
  sampledAtMs: number;
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  externalBytes: number;
  arrayBufferBytes: number;
  userCpuMicros: number;
  systemCpuMicros: number;
  maxRssKilobytes: number;
  eventBuffer: EventBufferSnapshot;
  child: ChildResourceSample | null;
};

export type ResourceSummary = {
  sampleCount: number;
  first: ResourceSample | null;
  last: ResourceSample | null;
  peakRssBytes: number;
  peakHeapUsedBytes: number;
  peakBufferedBytes: number;
  peakChildRssBytes: number | null;
  peakChildDescriptorCount: number | null;
};

type MemoryReader = () => NodeJS.MemoryUsage;
type CpuReader = () => NodeJS.ResourceUsage;

export class ResourceSampler {
  private readonly samples: ResourceSample[] = [];

  constructor(
    private readonly maxSamples = 120,
    private readonly now: () => number = Date.now,
    private readonly readMemory: MemoryReader = process.memoryUsage,
    private readonly readCpu: CpuReader = process.resourceUsage,
  ) {
    if (maxSamples < 1) {
      throw new RangeError("Resource sampler must retain at least one sample");
    }
  }

  sample(
    eventBuffer: EventBufferSnapshot,
    child: ChildResourceSample | null = null,
  ): ResourceSample {
    const memory = this.readMemory();
    const cpu = this.readCpu();
    const sample: ResourceSample = {
      sampledAtMs: this.now(),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
      arrayBufferBytes: memory.arrayBuffers,
      userCpuMicros: cpu.userCPUTime,
      systemCpuMicros: cpu.systemCPUTime,
      maxRssKilobytes: cpu.maxRSS,
      eventBuffer,
      child,
    };
    this.samples.push(sample);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
    return sample;
  }

  summary(): ResourceSummary {
    return {
      sampleCount: this.samples.length,
      first: this.samples.at(0) ?? null,
      last: this.samples.at(-1) ?? null,
      peakRssBytes: this.max((sample) => sample.rssBytes),
      peakHeapUsedBytes: this.max((sample) => sample.heapUsedBytes),
      peakBufferedBytes: this.max((sample) => sample.eventBuffer.bytes),
      peakChildRssBytes: this.maxNullable((sample) => sample.child?.rssBytes ?? null),
      peakChildDescriptorCount: this.maxNullable(
        (sample) => sample.child?.descriptorCount ?? null,
      ),
    };
  }

  private max(read: (sample: ResourceSample) => number): number {
    return this.samples.reduce((highest, sample) => Math.max(highest, read(sample)), 0);
  }

  private maxNullable(read: (sample: ResourceSample) => number | null): number | null {
    let highest: number | null = null;
    for (const sample of this.samples) {
      const value = read(sample);
      if (value !== null) {
        highest = highest === null ? value : Math.max(highest, value);
      }
    }
    return highest;
  }
}
