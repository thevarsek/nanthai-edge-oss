import assert from "node:assert/strict";
import test from "node:test";

import { resolveVideoAudioParameter } from "../chat/video_generation_capabilities";

test("video audio is omitted unless the selected model advertises support", () => {
  assert.equal(resolveVideoAudioParameter(false, true), undefined);
  assert.equal(resolveVideoAudioParameter(undefined, true), undefined);
  assert.equal(resolveVideoAudioParameter(true, undefined), true);
  assert.equal(resolveVideoAudioParameter(true, false), false);
});
