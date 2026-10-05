import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { UsageObservationSchema, UsageFileSchema, createMonth, addObservation } from "../../shared/runtime_usage.mts";
import type { UsageObservation, MonthlyUsage } from "../../shared/runtime_usage.mts";
export type { UsageObservation, MonthlyUsage } from "../../shared/runtime_usage.mts";

export interface UsageRecorder {
  record(observation: UsageObservation): Promise<void>;
}

export interface UsageReader {
  list(month?: string): Promise<readonly MonthlyUsage[]>;
}

export class UsageHistory implements UsageRecorder, UsageReader {
  private operation = Promise.resolve();

  constructor(private readonly path: string) {}

  record(observation: UsageObservation): Promise<void> {
    return this.serialize(async () => {
      const value = UsageObservationSchema.parse(observation);
      const months = await this.read();
      const month = new Date(value.occurredAtMs).toISOString().slice(0, 7);
      const index = months.findIndex((entry) => entry.month === month
        && entry.provider === value.provider && entry.modelId === value.modelId);
      if (index < 0) months.push(createMonth(month, value));
      else months[index] = addObservation(months[index]!, value);
      months.sort((left, right) => right.month.localeCompare(left.month));
      await this.write(months);
    });
  }

  list(month?: string): Promise<readonly MonthlyUsage[]> {
    return this.serialize(async () => {
      const months = await this.read();
      return month === undefined ? months : months.filter((entry) => entry.month === month);
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operation.then(operation, operation);
    this.operation = result.then(() => undefined, () => undefined);
    return result;
  }

  private async read(): Promise<MonthlyUsage[]> {
    try {
      return UsageFileSchema.parse(JSON.parse(await readFile(this.path, "utf8")) as unknown).months;
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }

  private async write(months: readonly MonthlyUsage[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, months }), {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, this.path);
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}
