import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { MAX_ADVISOR_PARTIAL_CHARS } from "./constants";

const FLUSH_INTERVAL_MS = 120;
const FLUSH_SIZE_CHARS = 256;

export class AdvisorStreamWriter {
  private content = "";
  private pendingChars = 0;
  private lastFlushAt = 0;
  private readonly ctx: ActionCtx;
  private readonly runId: Id<"advisorRuns">;
  private readonly leaseOwner: string;

  constructor(
    ctx: ActionCtx,
    runId: Id<"advisorRuns">,
    leaseOwner: string,
  ) {
    this.ctx = ctx;
    this.runId = runId;
    this.leaseOwner = leaseOwner;
  }

  get totalContent(): string {
    return this.content;
  }

  async append(delta: string): Promise<void> {
    if (!delta) return;
    const remaining = MAX_ADVISOR_PARTIAL_CHARS - this.content.length;
    if (remaining <= 0) return;
    const bounded = delta.slice(0, remaining);
    this.content += bounded;
    this.pendingChars += bounded.length;
    const now = Date.now();
    if (
      this.pendingChars >= FLUSH_SIZE_CHARS ||
      now - this.lastFlushAt >= FLUSH_INTERVAL_MS
    ) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.pendingChars === 0) return;
    const accepted = await this.ctx.runMutation(
      internal.advisors.mutations_internal.updateRunStreaming,
      { runId: this.runId, leaseOwner: this.leaseOwner, partialAdvice: this.content },
    );
    if (!accepted) throw new Error("Advisor consultation cancelled");
    this.pendingChars = 0;
    this.lastFlushAt = Date.now();
  }
}
