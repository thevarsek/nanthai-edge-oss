import assert from "node:assert/strict";
import test from "node:test";

import {
  extensionForAudioMimeType,
  parseMp3DurationMs,
} from "../chat/audio_shared.ts";
import { normalizeInlineAudioOutput } from "../chat/audio_output_persistence.ts";

function buildSyntheticMp3Frame(): Buffer {
  const frame = Buffer.alloc(417, 0x00);
  frame[0] = 0xff;
  frame[1] = 0xfb;
  frame[2] = 0x90;
  frame[3] = 0x00;
  return frame;
}

test("parseMp3DurationMs rejects empty and non-MP3 data", () => {
  assert.equal(parseMp3DurationMs(Buffer.alloc(0)), 0);
  assert.equal(parseMp3DurationMs(Buffer.from("not mp3")), 0);
});

test("parseMp3DurationMs calculates synthetic MPEG1 Layer III frames", () => {
  const frames = Buffer.concat(
    Array.from({ length: 100 }, () => buildSyntheticMp3Frame()),
  );
  assert.equal(
    parseMp3DurationMs(frames),
    Math.round((1152 / 44_100) * 1_000 * 100),
  );
});

test("normalizeInlineAudioOutput preserves self-describing MP3 output", () => {
  const source = Buffer.concat([
    Buffer.from([0x49, 0x44, 0x33, 0x03, 0, 0, 0, 0, 0, 0]),
    buildSyntheticMp3Frame(),
  ]);
  const normalized = normalizeInlineAudioOutput(source.toString("base64"));

  assert.equal(normalized.mimeType, "audio/mpeg");
  assert.equal(normalized.extension, "mp3");
  assert.deepEqual(normalized.bytes, source);
  assert.equal(normalized.sizeBytes, source.length);
  assert.ok(normalized.durationMs > 0);
});

test("normalizeInlineAudioOutput wraps negotiated PCM16 in a playable WAV", () => {
  const pcm = Buffer.alloc(48_000, 0x01);
  const normalized = normalizeInlineAudioOutput(pcm.toString("base64"));

  assert.equal(normalized.mimeType, "audio/wav");
  assert.equal(normalized.extension, "wav");
  assert.equal(normalized.durationMs, 1_000);
  assert.equal(normalized.bytes.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(normalized.bytes.subarray(8, 12).toString("ascii"), "WAVE");
  assert.equal(normalized.sizeBytes, pcm.length + 44);
});

test("audio file extensions come from MIME metadata, not model IDs", () => {
  assert.equal(extensionForAudioMimeType("audio/mpeg"), "mp3");
  assert.equal(extensionForAudioMimeType("audio/flac"), "flac");
  assert.equal(extensionForAudioMimeType("audio/ogg"), "ogg");
  assert.equal(extensionForAudioMimeType("audio/wav"), "wav");
});
