import { stripSourceEvidence } from "./source_evidence.ts";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { z } from "zod";
import { LocalRuntimeTurnPacketSchema, WorkerToHostMessageSchema, PublishResultSchema } from "./protocol.ts";
import { atomicTurnPlan } from "./runtime_command_translation.ts";
import type { RuntimeCommand, RuntimeEvent } from "./control_plane.ts";
import { eventOutcome } from "./runtime_event_outcome.ts";

const FileSchema = z.object({ filename: z.string(), mimeType: z.string(), content: z.string(), callId: z.string() })
  .transform(value => ({ ...PublishResultSchema.parse({ filename: value.filename, mimeType: value.mimeType, content: value.content }), callId: value.callId }));
export const SavedTaskSchema = z.object({
  version: z.literal(1), id: z.string(), deviceId: z.string(), server: z.string(),
  packet: LocalRuntimeTurnPacketSchema, title: z.string(), output: z.string(),
  nativeSessionId: z.string().nullable().default(null), nativeTurnId: z.string().nullable().default(null),
  outcome: z.string().nullable(), updatedAt: z.number(), files: z.array(FileSchema),
});
export type SavedTask = z.infer<typeof SavedTaskSchema>;
export const LocalResultSchema = z.object({
  version: z.literal(1), id: z.string(), taskId: z.string(), prompt: z.string(), output: z.string(),
  outcome: z.string().nullable(), files: z.array(FileSchema), createdAt: z.number(),
  baseOutputHash: z.string(), previousResultId: z.string().nullable(), ownerPid: z.number(),
  sourceCitations: z.array(z.object({ sourceId: z.string(), kind: z.string(), label: z.string(), quote: z.string(), claim: z.string().optional() })).optional(),
  usage: z.array(z.unknown()), synced: z.boolean(), disposition: z.string().nullable(),
});
export type LocalResult = z.infer<typeof LocalResultSchema>;

/** Only checkpoints received by this paired host are saved; native history is never scanned. */
export class SavedTaskStore {
  constructor(readonly root: string) {}
  taskDirectory(id: string): string { return join(this.root, "tasks", digest(id)); }
  resultDirectory(id: string): string { return join(this.root, "results", digest(id)); }
  async saveTask(task: SavedTask): Promise<void> {
    await atomicJson(join(this.taskDirectory(task.id), "task.json"), SavedTaskSchema.parse(task));
  }
  async task(id: string): Promise<SavedTask> {
    return SavedTaskSchema.parse(JSON.parse(await readFile(join(this.taskDirectory(id), "task.json"), "utf8")));
  }
  async tasks(): Promise<SavedTask[]> { return this.list("tasks", "task.json", SavedTaskSchema); }
  async results(): Promise<LocalResult[]> { return this.list("results", "result.json", LocalResultSchema); }
  async saveResult(result: LocalResult): Promise<void> {
    await atomicJson(join(this.resultDirectory(result.id), "result.json"), LocalResultSchema.parse(result));
  }
  async artifactPaths(owner: string, files: SavedTask["files"], result = false): Promise<Array<{ filename: string; path: string }>> {
    const paths: Array<{ filename: string; path: string }> = [];
    for (const file of files) {
      const path = join(result ? this.resultDirectory(owner) : this.taskDirectory(owner), "artifacts", `${digest(file.callId)}-${file.filename}`);
      let identical = false;
      try { identical = await readFile(path, "utf8") === file.content; } catch (error) { if (!missing(error)) throw error; }
      if (!identical) await atomicText(path, file.content);
      paths.push({ filename: file.filename, path });
    }
    return paths;
  }
  async capture(command: RuntimeCommand, deviceId: string, server: string, directory: string | null): Promise<SavedTask> {
    const packet = atomicTurnPlan(command).packet;
    const task: SavedTask = { version: 1, id: packet.runId, deviceId, server, packet,
      title: packet.messages.find(message => message.messageId === packet.sourceMessageId)?.content
        .filter(part => part.type === "text").map(part => part.text).join(" ").slice(0, 160) ?? "Saved task",
      output: "", nativeSessionId: null, nativeTurnId: null, outcome: null, updatedAt: Date.now(), files: [] };
    if (directory) await cp(directory, join(this.taskDirectory(task.id), "parts"), { recursive: true, force: true });
    await this.saveTask(task);
    return task;
  }
  async record(task: SavedTask, event: RuntimeEvent): Promise<void> {
    const message = WorkerToHostMessageSchema.safeParse(event.payload);
    if (message.success && message.data.kind === "session_result") task.nativeSessionId = message.data.payload.nativeSessionId ?? null;
    if (message.success && message.data.kind === "terminal_event") task.nativeTurnId = message.data.payload.event.nativeTurnId ?? null;
    const delta = textDelta(event);
    if (delta !== null) task.output += delta;
    task.outcome = eventOutcome(event) ?? task.outcome;
    if (task.outcome) task.output = stripSourceEvidence(task.output);
    task.updatedAt = event.emittedAtMs;
    if (delta !== null || task.outcome !== null || task.nativeSessionId !== null) await this.saveTask(task);
  }
  private async list<T>(folder: string, file: string, schema: z.ZodType<T>): Promise<T[]> {
    let names: string[];
    try { names = await readdir(join(this.root, folder)); }
    catch (error) { if (missing(error)) return []; throw error; }
    const values = await Promise.all(names.filter(name => /^[a-f0-9]{64}$/.test(name)).map(async name => {
      try { return schema.parse(JSON.parse(await readFile(join(this.root, folder, name, file), "utf8"))); }
      catch (error) { if (missing(error)) return null; throw error; }
    }));
    return values.filter(value => value !== null) as T[];

  }
}

export function textDelta(event: RuntimeEvent): string | null {
  const parsed = WorkerToHostMessageSchema.safeParse(event.payload);
  if (!parsed.success || parsed.data.kind !== "adapter_event") return null;
  const adapter = parsed.data.payload.event;
  return adapter.type === "text_delta" ? adapter.delta : null;
}
export async function atomicJson(path: string, value: unknown): Promise<void> {
  await atomicText(path, JSON.stringify(value));
}
async function atomicText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(content); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, path);
    const directory = await open(dirname(path), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await rm(temporary, { force: true }); }
}
export function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function missing(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "ENOENT"; }
