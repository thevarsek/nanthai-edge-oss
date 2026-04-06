import assert from "node:assert/strict";
import test from "node:test";

import { pcm16Base64ToWavBuffer } from "../chat/audio_shared.ts";

test("pcm16Base64ToWavBuffer wraps raw pcm16 in a wav container", () => {
  const wav = pcm16Base64ToWavBuffer("AAABAA==", 24_000);

  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.toString("ascii", 12, 16), "fmt ");
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 24_000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.toString("ascii", 36, 40), "data");
  assert.equal(wav.readUInt32LE(40), 4);
  assert.deepEqual([...wav.subarray(44)], [0, 0, 1, 0]);
});
