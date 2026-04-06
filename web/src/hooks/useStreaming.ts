// hooks/useStreaming.ts
// Character-level interpolation for streaming messages.
// Mirrors iOS StreamingRenderEngine: progressively reveals characters at
// ~220 chars/sec with backlog-based boosting, capped at ~15 FPS to avoid
// layout thrash. First chunk appears instantly; subsequent chunks are
// smoothly drip-fed.

import { useEffect, useRef, useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Tuning constants — matched to iOS StreamingRenderEngine
// ---------------------------------------------------------------------------
const TARGET_FPS = 15;
const FRAME_MS = 1000 / TARGET_FPS; // ~66ms
const BASE_CHARS_PER_SECOND = 220;
const MAX_BACKLOG_BOOST = 6.0;

interface StreamingState {
  /** The content currently rendered (may lag behind the live value). */
  displayed: string;
  /** True while we still have characters to drip-feed. */
  isAnimating: boolean;
}

/**
 * Given a `liveContent` string that grows as the backend streams characters,
 * returns a `displayed` string that smoothly reveals characters at a natural
 * reading pace instead of dumping entire chunks at once.
 *
 * Algorithm (ported from iOS StreamingRenderEngine):
 * - On first content arrival, all content is shown immediately (no delay).
 * - On subsequent updates, `displayedCount` advances toward `targetCount`
 *   at ~220 chars/sec, boosted up to 6x when the backlog grows large.
 * - Large backlogs (>300 or >900 chars) get extra step bonuses to prevent
 *   the display from falling too far behind.
 * - When streaming completes, displayed snaps to final content immediately.
 */
export function useStreaming(
  liveContent: string,
  isStreaming: boolean,
): StreamingState {
  const [displayed, setDisplayed] = useState(liveContent);

  // Mutable refs for the animation loop (avoid re-renders / stale closures)
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number>(0);
  const liveRef = useRef(liveContent);
  const isStreamingRef = useRef(isStreaming);

  // Track state — mirrors iOS Track struct
  const displayedCountRef = useRef(liveContent.length); // chars currently shown
  const targetCountRef = useRef(liveContent.length);
  const targetTextRef = useRef(liveContent);
  const hasTrackRef = useRef(false); // whether we've started tracking

  // Keep refs in sync on every render (no re-renders triggered)
  liveRef.current = liveContent;
  isStreamingRef.current = isStreaming;

  // Ingest new content — called whenever liveContent changes during streaming.
  // Mirrors iOS ingest(): first content shows immediately, subsequent content
  // updates the target and lets advance() catch up.
  const ingest = useCallback((text: string) => {
    const targetLen = text.length;

    if (!hasTrackRef.current) {
      // First ingest: show everything immediately (same as iOS new-track path)
      hasTrackRef.current = true;
      displayedCountRef.current = targetLen;
      targetCountRef.current = targetLen;
      targetTextRef.current = text;
      setDisplayed(text);
      return;
    }

    // Subsequent ingest: only update target; advance() will catch up
    if (targetTextRef.current !== text) {
      targetTextRef.current = text;
      targetCountRef.current = targetLen;
      // If content was replaced/truncated, clamp displayed
      if (displayedCountRef.current > targetLen) {
        displayedCountRef.current = targetLen;
        setDisplayed(text.slice(0, targetLen));
      }
    }
  }, []);

  // Advance displayed count toward target — called each RAF tick.
  // Mirrors iOS advance() with identical boosting math.
  const advance = useCallback((nowMs: number): boolean => {
    const backlog = targetCountRef.current - displayedCountRef.current;
    if (backlog <= 0) {
      lastFrameRef.current = nowMs;
      return false;
    }

    const elapsedMs = Math.max(16.0, nowMs - lastFrameRef.current);
    const backlogBoost = Math.min(
      MAX_BACKLOG_BOOST,
      1.0 + backlog / 240.0,
    );
    let step = Math.floor(
      (BASE_CHARS_PER_SECOND * backlogBoost * elapsedMs) / 1000.0,
    );

    // Extra step bonuses for large backlogs (iOS parity)
    if (backlog > 900) {
      step += Math.min(180, Math.floor(backlog / 8));
    } else if (backlog > 300) {
      step += Math.min(80, Math.floor(backlog / 10));
    }

    step = Math.max(1, step);
    const nextCount = Math.min(
      targetCountRef.current,
      displayedCountRef.current + step,
    );

    if (nextCount !== displayedCountRef.current) {
      displayedCountRef.current = nextCount;
      lastFrameRef.current = nowMs;
      setDisplayed(targetTextRef.current.slice(0, nextCount));
      return true;
    }

    lastFrameRef.current = nowMs;
    return false;
  }, []);

  // RAF animation loop
  const tick = useCallback(
    function tickFrame(now: number) {
      if (!isStreamingRef.current) {
        // Streaming ended mid-frame — snap to final
        setDisplayed(liveRef.current);
        rafRef.current = null;
        return;
      }

      const elapsed = now - lastFrameRef.current;
      if (elapsed >= FRAME_MS) {
        // Ingest latest content, then advance the interpolation
        ingest(liveRef.current);
        advance(now);
      }

      rafRef.current = requestAnimationFrame(tickFrame);
    },
    [ingest, advance],
  );

  // Start/stop the animation loop based on streaming state
  useEffect(() => {
    if (isStreaming) {
      // Ingest immediately so the first chunk appears without waiting for RAF
      ingest(liveContent);

      if (rafRef.current === null) {
        lastFrameRef.current = performance.now();
        rafRef.current = requestAnimationFrame(tick);
      }
    } else {
      // Streaming ended — cancel loop, snap to final, reset track
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      hasTrackRef.current = false;
      displayedCountRef.current = liveContent.length;
      targetCountRef.current = liveContent.length;
      targetTextRef.current = liveContent;
      setDisplayed(liveContent);
    }

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isStreaming, liveContent, tick, ingest]);

  const isAnimating =
    isStreaming && displayedCountRef.current < targetCountRef.current;

  return { displayed, isAnimating };
}
