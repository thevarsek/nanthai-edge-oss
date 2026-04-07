import assert from "node:assert/strict";
import test from "node:test";

import {
  isLyriaModel,
  LYRIA_CLIP_MODEL,
  LYRIA_MP3_MIME_TYPE,
  LYRIA_PRO_MODEL,
  parseMp3DurationMs,
} from "../chat/audio_shared.ts";

// ── isLyriaModel ──────────────────────────────────────────────────────

test("isLyriaModel returns true for clip model", () => {
  assert.equal(isLyriaModel(LYRIA_CLIP_MODEL), true);
});

test("isLyriaModel returns true for pro model", () => {
  assert.equal(isLyriaModel(LYRIA_PRO_MODEL), true);
});

test("isLyriaModel returns false for non-Lyria models", () => {
  assert.equal(isLyriaModel("openai/gpt-4o"), false);
  assert.equal(isLyriaModel("google/gemini-2.0-flash-001"), false);
  assert.equal(isLyriaModel("anthropic/claude-3.5-sonnet"), false);
});

test("isLyriaModel returns false for null/undefined/empty", () => {
  assert.equal(isLyriaModel(null), false);
  assert.equal(isLyriaModel(undefined), false);
  assert.equal(isLyriaModel(""), false);
});

// ── Constants ─────────────────────────────────────────────────────────

test("LYRIA_CLIP_MODEL has expected slug", () => {
  assert.equal(LYRIA_CLIP_MODEL, "google/lyria-3-clip-preview");
});

test("LYRIA_PRO_MODEL has expected slug", () => {
  assert.equal(LYRIA_PRO_MODEL, "google/lyria-3-pro-preview");
});

test("LYRIA_MP3_MIME_TYPE is audio/mpeg", () => {
  assert.equal(LYRIA_MP3_MIME_TYPE, "audio/mpeg");
});

// ── parseMp3DurationMs ────────────────────────────────────────────────

test("parseMp3DurationMs returns 0 for empty buffer", () => {
  assert.equal(parseMp3DurationMs(Buffer.alloc(0)), 0);
});

test("parseMp3DurationMs returns 0 for non-MP3 data", () => {
  // Random bytes that don't form valid MPEG sync frames.
  const garbage = Buffer.from("Hello, this is not an MP3 file at all!");
  assert.equal(parseMp3DurationMs(garbage), 0);
});

test("parseMp3DurationMs skips ID3v2 header", () => {
  // Build a minimal ID3v2.3 header with 0 data bytes (size = 0).
  // "ID3" + version 3.0 + flags=0 + size=0000
  const id3Header = Buffer.from([
    0x49, 0x44, 0x33, // "ID3"
    0x03, 0x00,       // version 3.0
    0x00,             // flags
    0x00, 0x00, 0x00, 0x00, // size = 0 (synchsafe)
  ]);
  // After ID3 header, append garbage that doesn't look like MPEG frames.
  const buf = Buffer.concat([id3Header, Buffer.alloc(20, 0x00)]);
  // Should parse without crashing, return 0 (no frames).
  assert.equal(parseMp3DurationMs(buf), 0);
});

/**
 * Build a synthetic MPEG1 Layer III frame header.
 *
 * MPEG1 Layer III, 128kbps, 44100Hz, no padding:
 *   Byte 0: 0xFF (sync)
 *   Byte 1: 0xFB (sync + MPEG1 + Layer III + no CRC)
 *     1111 1 11 1 10 1 1 → FF FB
 *     sync=11111111111, version=11(MPEG1), layer=01(III), protection=1(no CRC)
 *   Byte 2: 0x90 (128kbps, 44100Hz, no padding)
 *     bitrate=1001(128kbps for MPEG1 L3), sampleRate=00(44100Hz), padding=0, private=0
 *   Byte 3: 0x00 (joint stereo, no emphasis — doesn't matter for size calc)
 *
 * Frame size = floor(1152/8 * (128000/44100) + 0) = floor(144 * 128000/44100) = floor(417.959) = 417 bytes
 */
function buildSyntheticMp3Frame(): Buffer {
  const frameSize = 417;
  const frame = Buffer.alloc(frameSize, 0x00);
  frame[0] = 0xff;
  frame[1] = 0xfb; // MPEG1, Layer III, no CRC
  frame[2] = 0x90; // 128kbps, 44100Hz, no padding
  frame[3] = 0x00;
  return frame;
}

test("parseMp3DurationMs calculates duration for a single synthetic MPEG1 L3 frame", () => {
  const frame = buildSyntheticMp3Frame();
  const durationMs = parseMp3DurationMs(frame);
  // One MPEG1 L3 frame = 1152 samples / 44100 Hz ≈ 26.122 ms
  const expectedMs = Math.round((1152 / 44100) * 1000);
  assert.equal(durationMs, expectedMs);
});

test("parseMp3DurationMs calculates duration for multiple frames", () => {
  const frame = buildSyntheticMp3Frame();
  const numFrames = 100;
  const mp3 = Buffer.concat(Array.from({ length: numFrames }, () => frame));
  const durationMs = parseMp3DurationMs(mp3);
  const expectedMs = Math.round((1152 / 44100) * 1000 * numFrames);
  assert.equal(durationMs, expectedMs);
});

test("parseMp3DurationMs handles ID3 + frames", () => {
  // ID3v2 header with 4 bytes of tag data
  const id3Header = Buffer.from([
    0x49, 0x44, 0x33, // "ID3"
    0x03, 0x00,       // version 3.0
    0x00,             // flags
    0x00, 0x00, 0x00, 0x04, // size = 4 (synchsafe)
  ]);
  const id3Data = Buffer.alloc(4, 0x00); // 4 bytes of tag data
  const frame = buildSyntheticMp3Frame();
  const numFrames = 50;
  const mp3 = Buffer.concat([
    id3Header,
    id3Data,
    ...Array.from({ length: numFrames }, () => frame),
  ]);
  const durationMs = parseMp3DurationMs(mp3);
  const expectedMs = Math.round((1152 / 44100) * 1000 * numFrames);
  assert.equal(durationMs, expectedMs);
});

test("parseMp3DurationMs gives ~30s for a typical Lyria clip frame count", () => {
  // Lyria clip ≈ 30s. At 44100Hz, 1152 samples/frame:
  // 30 * 44100 / 1152 ≈ 1148 frames
  const frame = buildSyntheticMp3Frame();
  const numFrames = 1148;
  const mp3 = Buffer.concat(Array.from({ length: numFrames }, () => frame));
  const durationMs = parseMp3DurationMs(mp3);
  // Should be approximately 30000ms (within ~50ms)
  assert.ok(
    Math.abs(durationMs - 30000) < 50,
    `Expected ~30000ms, got ${durationMs}ms`,
  );
});
