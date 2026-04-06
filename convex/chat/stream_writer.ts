// convex/chat/stream_writer.ts
// =============================================================================
// Shared streaming content + reasoning writer.
// Encapsulates the throttled patch cadence used by all stream producers.
// =============================================================================

import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import {
  shouldPatchStreamingContent,
  shouldPatchStreamingReasoning,
  shouldForceReasoningPatchOnContentStart,
} from "./stream_patch_throttle";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StreamWriterOptions {
  ctx: ActionCtx;
  messageId: Id<"messages">;
  /**
   * Optional hook called before each content patch to allow the caller to
   * run cancellation checks or other side-effects. Throw to abort the stream.
   */
  beforePatch?: () => Promise<void>;
  /**
   * Transform content before writing to DB (e.g. clampMessageContent).
   * Defaults to identity.
   */
  transformContent?: (content: string) => string;
  /**
   * Guard that must return true for reasoning to be persisted.
   * Defaults to `totalReasoning.length > 0`.
   */
  shouldPersistReasoning?: (totalReasoning: string) => boolean;
}

// ---------------------------------------------------------------------------
// StreamWriter
// ---------------------------------------------------------------------------

export class StreamWriter {
  private ctx: ActionCtx;
  private messageId: Id<"messages">;
  private beforePatch: (() => Promise<void>) | undefined;
  private transformContent: (content: string) => string;
  private shouldPersistReasoning: (totalReasoning: string) => boolean;

  // Content state
  private _totalContent = "";
  private lastPatchedContentLength = 0;
  private lastPatchedContentAtMs = 0;
  private contentStartedAtMs: number | undefined;

  // Reasoning state
  private _totalReasoning = "";
  private lastPatchedReasoningLength = 0;
  private lastPatchedReasoningAtMs = 0;

  // Boundary tracking
  private _hasSeenContentDelta = false;

  constructor(opts: StreamWriterOptions) {
    this.ctx = opts.ctx;
    this.messageId = opts.messageId;
    this.beforePatch = opts.beforePatch;
    this.transformContent = opts.transformContent ?? ((c) => c);
    this.shouldPersistReasoning =
      opts.shouldPersistReasoning ?? ((r) => r.length > 0);
  }

  // -- Public accessors -----------------------------------------------------

  get totalContent(): string {
    return this._totalContent;
  }

  get totalReasoning(): string {
    return this._totalReasoning;
  }

  get hasSeenContentDelta(): boolean {
    return this._hasSeenContentDelta;
  }

  // -- Content patching -----------------------------------------------------

  async appendContent(delta: string): Promise<void> {
    if (delta.length === 0) return;
    if (this.contentStartedAtMs === undefined) {
      this.contentStartedAtMs = Date.now();
    }
    this._totalContent += delta;
  }

  async patchContentIfNeeded(force = false): Promise<void> {
    const nowMs = Date.now();
    if (
      !shouldPatchStreamingContent({
        force,
        nowMs,
        totalContentLength: this._totalContent.length,
        lastPatchedContentLength: this.lastPatchedContentLength,
        lastPatchedContentAtMs: this.lastPatchedContentAtMs,
        contentStartedAtMs: this.contentStartedAtMs,
      })
    ) {
      return;
    }

    if (this.beforePatch) {
      await this.beforePatch();
    }

    await this.ctx.runMutation(internal.chat.mutations.updateMessageContent, {
      messageId: this.messageId,
      content: this.transformContent(this._totalContent),
      status: "streaming",
    });
    this.lastPatchedContentLength = this._totalContent.length;
    this.lastPatchedContentAtMs = nowMs;
    this.contentStartedAtMs = nowMs;
  }

  // -- Reasoning patching ---------------------------------------------------

  async appendReasoning(delta: string): Promise<void> {
    if (delta.length === 0) return;
    this._totalReasoning += delta;
  }

  async patchReasoningIfNeeded(force = false): Promise<void> {
    if (!this.shouldPersistReasoning(this._totalReasoning)) {
      return;
    }

    const nowMs = Date.now();
    if (
      !shouldPatchStreamingReasoning({
        force,
        nowMs,
        totalReasoningLength: this._totalReasoning.length,
        lastPatchedReasoningLength: this.lastPatchedReasoningLength,
        lastPatchedReasoningAtMs: this.lastPatchedReasoningAtMs,
      })
    ) {
      return;
    }

    if (this.beforePatch) {
      await this.beforePatch();
    }

    await this.ctx.runMutation(
      internal.chat.mutations.updateMessageReasoning,
      {
        messageId: this.messageId,
        reasoning: this._totalReasoning,
      },
    );
    this.lastPatchedReasoningLength = this._totalReasoning.length;
    this.lastPatchedReasoningAtMs = nowMs;
  }

  // -- Boundary helpers -----------------------------------------------------

  /**
   * Call at the start of every onDelta callback to handle the
   * reasoning→content boundary force-flush.
   */
  async handleContentDeltaBoundary(deltaLength: number): Promise<void> {
    if (
      shouldForceReasoningPatchOnContentStart({
        hasSeenContentDelta: this._hasSeenContentDelta,
        incomingContentDeltaLength: deltaLength,
        totalReasoningLength: this._totalReasoning.length,
        lastPatchedReasoningLength: this.lastPatchedReasoningLength,
      })
    ) {
      await this.patchReasoningIfNeeded(true);
    }
    if (!this._hasSeenContentDelta && deltaLength > 0) {
      this._hasSeenContentDelta = true;
    }
  }

  // -- Flush both -----------------------------------------------------------

  async flush(): Promise<void> {
    await this.patchContentIfNeeded(true);
    await this.patchReasoningIfNeeded(true);
  }
}
