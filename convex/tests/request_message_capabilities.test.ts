import assert from "node:assert/strict";
import test from "node:test";
import { adaptMessagesForImageInput } from "../chat/request_message_capabilities";

const messages = [{
  role: "user" as const,
  content: [
    { type: "text" as const, text: "Describe the previous result" },
    { type: "image_url" as const, image_url: { url: "https://files.example/generated.png" } },
  ],
}, {
  role: "user" as const,
  content: [{
    type: "image_url" as const,
    image_url: { url: "https://files.example/image-only.png" },
  }],
}];

test("text-only participants never receive generated image parts", () => {
  const adapted = adaptMessagesForImageInput(messages, false);
  assert.deepEqual(adapted[0]?.content, [{ type: "text", text: "Describe the previous result" }]);
  assert.deepEqual(adapted[1]?.content, [{
    type: "text",
    text: "[Image omitted because this model does not support image input.]",
  }]);
  assert.equal(JSON.stringify(adapted).includes("image_url"), false);
});

test("vision and dedicated image participants retain image context unchanged", () => {
  assert.strictEqual(adaptMessagesForImageInput(messages, true), messages);
});
