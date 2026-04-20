import assert from "node:assert/strict";
import test from "node:test";

import {
  bytesToBase64,
  isAudioAttachment,
  guessAudioInputFormat,
} from "../chat/audio_runtime";

test("bytesToBase64 encodes empty input", () => {
  assert.equal(bytesToBase64(new Uint8Array([])), "");
});

test("bytesToBase64 encodes known test vectors matching Buffer.from", () => {
  // Single byte (needs padding ==)
  const one = new Uint8Array([0x4d]);
  assert.equal(bytesToBase64(one), Buffer.from(one).toString("base64"));

  // Two bytes (needs padding =)
  const two = new Uint8Array([0x4d, 0x61]);
  assert.equal(bytesToBase64(two), Buffer.from(two).toString("base64"));

  // Three bytes (no padding)
  const three = new Uint8Array([0x4d, 0x61, 0x6e]);
  assert.equal(bytesToBase64(three), Buffer.from(three).toString("base64"));

  // "Hello, World!" — multi-byte
  const hello = new TextEncoder().encode("Hello, World!");
  assert.equal(bytesToBase64(hello), Buffer.from(hello).toString("base64"));

  // Binary data with all byte values 0-255
  const allBytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) allBytes[i] = i;
  assert.equal(bytesToBase64(allBytes), Buffer.from(allBytes).toString("base64"));
});

test("isAudioAttachment detects audio by type or mimeType", () => {
  assert.equal(isAudioAttachment(null), false);
  assert.equal(isAudioAttachment(undefined), false);
  assert.equal(isAudioAttachment({}), false);
  assert.equal(isAudioAttachment({ type: "image" }), false);
  assert.equal(isAudioAttachment({ type: "audio" }), true);
  assert.equal(isAudioAttachment({ mimeType: "audio/mp3" }), true);
  assert.equal(isAudioAttachment({ mimeType: "audio/wav" }), true);
  assert.equal(isAudioAttachment({ mimeType: "video/mp4" }), false);
});

test("guessAudioInputFormat resolves from mimeType", () => {
  assert.equal(guessAudioInputFormat("audio/mpeg"), "mp3");
  assert.equal(guessAudioInputFormat("audio/mp3"), "mp3");
  assert.equal(guessAudioInputFormat("audio/aac"), "aac");
  assert.equal(guessAudioInputFormat("audio/ogg"), "ogg");
  assert.equal(guessAudioInputFormat("audio/flac"), "flac");
  assert.equal(guessAudioInputFormat("audio/wav"), "wav");
  assert.equal(guessAudioInputFormat("audio/x-wav"), "wav");
  assert.equal(guessAudioInputFormat("audio/wave"), "wav");
  assert.equal(guessAudioInputFormat("audio/aiff"), "aiff");
  assert.equal(guessAudioInputFormat("audio/pcm"), "pcm16");
  assert.equal(guessAudioInputFormat("audio/mp4"), "m4a");
  assert.equal(guessAudioInputFormat("audio/x-m4a"), "m4a");
});

test("guessAudioInputFormat falls back to extension", () => {
  assert.equal(guessAudioInputFormat(null, "recording.mp3"), "mp3");
  assert.equal(guessAudioInputFormat(null, "voice.wav"), "wav");
  assert.equal(guessAudioInputFormat(null, "note.m4a"), "m4a");
  assert.equal(guessAudioInputFormat(null, "audio.flac"), "flac");
  assert.equal(guessAudioInputFormat(null, "file.ogg"), "ogg");
});

test("guessAudioInputFormat defaults to m4a when unrecognized", () => {
  assert.equal(guessAudioInputFormat(null, null), "m4a");
  assert.equal(guessAudioInputFormat("application/octet-stream", "file.bin"), "m4a");
  assert.equal(guessAudioInputFormat(undefined, undefined), "m4a");
});
