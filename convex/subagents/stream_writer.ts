import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import {
  shouldForceReasoningPatchOnContentStart,
  shouldPatchStreamingContent,
  shouldPatchStreamingReasoning,
} from "../chat/stream_patch_throttle";

export class SubagentStreamWriter {
  private readonly ctx: ActionCtx;
  private readonly runId: Id<"subagentRuns">;
  private readonly beforePatch?: () => Promise<void>;
  private _totalContent = "";
  private _totalReasoning = "";
  private lastPatchedContentLength = 0;
  private lastPatchedContentAtMs = 0;
  private contentStartedAtMs: number | undefined;
  private lastPatchedReasoningLength = 0;
  private lastPatchedReasoningAtMs = 0;
  private _hasSeenContentDelta = false;

  constructor(opts: {
    ctx: ActionCtx;
    runId: Id<"subagentRuns">;
    beforePatch?: () => Promise<void>;
    initialContent?: string;
    initialReasoning?: string;
  }) {
    this.ctx = opts.ctx;
    this.runId = opts.runId;
    this.beforePatch = opts.beforePatch;
    this._totalContent = opts.initialContent ?? "";
    this._totalReasoning = opts.initialReasoning ?? "";
    this.lastPatchedContentLength = this._totalContent.length;
    this.lastPatchedReasoningLength = this._totalReasoning.length;
    this._hasSeenContentDelta = this._totalContent.length > 0;
    this.contentStartedAtMs = this._totalContent.length > 0 ? Date.now() : undefined;
  }

  get totalContent(): string { return this._totalContent; }
  get totalReasoning(): string { return this._totalReasoning; }
  get hasSeenContentDelta(): boolean { return this._hasSeenContentDelta; }

  async appendContent(delta: string): Promise<void> {
    if (delta.length === 0) return;
    if (this.contentStartedAtMs === undefined) {
      this.contentStartedAtMs = Date.now();
    }
    this._totalContent += delta;
  }

  async appendReasoning(delta: string): Promise<void> {
    if (delta.length === 0) return;
    this._totalReasoning += delta;
  }

  async patchContentIfNeeded(force = false): Promise<void> {
    const nowMs = Date.now();
    if (!shouldPatchStreamingContent({
      force,
      nowMs,
      totalContentLength: this._totalContent.length,
      lastPatchedContentLength: this.lastPatchedContentLength,
      lastPatchedContentAtMs: this.lastPatchedContentAtMs,
      contentStartedAtMs: this.contentStartedAtMs,
    })) {
      return;
    }

    if (this.beforePatch) await this.beforePatch();
    await this.ctx.runMutation(internal.subagents.mutations.updateRunStreaming, {
      runId: this.runId,
      content: this._totalContent,
      status: "streaming",
    });
    this.lastPatchedContentLength = this._totalContent.length;
    this.lastPatchedContentAtMs = nowMs;
    this.contentStartedAtMs = nowMs;
  }

  async patchReasoningIfNeeded(force = false): Promise<void> {
    if (!this._totalReasoning) return;
    const nowMs = Date.now();
    if (!shouldPatchStreamingReasoning({
      force,
      nowMs,
      totalReasoningLength: this._totalReasoning.length,
      lastPatchedReasoningLength: this.lastPatchedReasoningLength,
      lastPatchedReasoningAtMs: this.lastPatchedReasoningAtMs,
    })) {
      return;
    }

    if (this.beforePatch) await this.beforePatch();
    await this.ctx.runMutation(internal.subagents.mutations.updateRunStreaming, {
      runId: this.runId,
      reasoning: this._totalReasoning,
    });
    this.lastPatchedReasoningLength = this._totalReasoning.length;
    this.lastPatchedReasoningAtMs = nowMs;
  }

  async handleContentDeltaBoundary(deltaLength: number): Promise<void> {
    if (shouldForceReasoningPatchOnContentStart({
      hasSeenContentDelta: this._hasSeenContentDelta,
      incomingContentDeltaLength: deltaLength,
      totalReasoningLength: this._totalReasoning.length,
      lastPatchedReasoningLength: this.lastPatchedReasoningLength,
    })) {
      await this.patchReasoningIfNeeded(true);
    }
    if (!this._hasSeenContentDelta && deltaLength > 0) {
      this._hasSeenContentDelta = true;
    }
  }

  async flush(): Promise<void> {
    await this.patchContentIfNeeded(true);
    await this.patchReasoningIfNeeded(true);
  }
}
