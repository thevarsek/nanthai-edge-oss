import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

const HostStatusSchema = z.strictObject({
  pid: z.number().int().positive(),
  owner: z.enum(["foreground_cli", "tray"]),
  state: z.enum(["starting", "online", "stopping", "failed"]),
  deviceId: z.string().min(1),
  startedAtMs: z.number().int().nonnegative(),
  updatedAtMs: z.number().int().nonnegative(),
  activeAttempts: z.number().int().nonnegative(),
  queuedEvents: z.number().int().nonnegative(),
  rssBytes: z.number().int().nonnegative().optional(),
  heapUsedBytes: z.number().int().nonnegative().optional(),
  lastError: z.string().min(1).nullable(),
});

export type HostStatus = z.infer<typeof HostStatusSchema>;

export class HostStatusStore {
  constructor(private readonly path: string) {}

  async read(): Promise<HostStatus | null> {
    try {
      return HostStatusSchema.parse(JSON.parse(await readFile(this.path, "utf8")) as unknown);
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async write(status: HostStatus): Promise<void> {
    const validated = HostStatusSchema.parse(status);
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(validated), {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, this.path);
  }

  async removeIfOwnedBy(pid: number): Promise<void> {
    const current = await this.read();
    if (current?.pid !== pid) return;
    await unlink(this.path).catch((error: unknown) => {
      if (!isMissing(error)) throw error;
    });
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}
